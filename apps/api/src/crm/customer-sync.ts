import { hasAgencyCapability } from "../auth/access-policy";
import type { AppActor } from "../auth/types";
import { customerProfileDocument } from "./customer-sync-snapshot";
import type {
  DomainDocument,
  DocumentValue,
} from "../domains/contracts";
import type {
  CrmProviderAdapter,
  CrmRepository,
  CustomerCrmLink,
  CustomerCrmObjectKind,
  CustomerCrmSyncItem,
  CustomerCrmSyncReason,
  CustomerCrmSyncRepository,
  CustomerCrmSyncResponse,
} from "./contracts";
import {
  CrmConnectionAccessError,
  CrmUpstreamError,
} from "./contracts";

const hubspotProvider = "hubspot" as const;
const maximumConcurrency = 4;

type CustomerSyncDependencies = {
  /** Enabled only by the platform domain route after its administrator gate. */
  allowPlatformAdministration?: boolean;
  db: D1Database;
  connections: CrmRepository;
  mappings: CustomerCrmSyncRepository;
  adapters: Partial<Record<typeof hubspotProvider, CrmProviderAdapter>>;
  /** Automatic mirror mode clears Savia-owned remote fields that are now absent. */
  clearMissingFields?: boolean;
};

type NaturalCustomer = {
  input: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
  };
};

type LegalCustomer = {
  company: { name: string; phone?: string };
  representative?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
};

function asRecord(
  value: DocumentValue | undefined,
): Record<string, DocumentValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function nonEmptyString(value: DocumentValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function synchronizedString(
  value: DocumentValue | undefined,
  clearMissingFields: boolean,
): string | undefined {
  return clearMissingFields
    ? typeof value === "string"
      ? value.trim()
      : ""
    : nonEmptyString(value);
}

function firstValue(value: DocumentValue | undefined): string | undefined {
  if (typeof value === "string") return nonEmptyString(value);
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => nonEmptyString(item)).find(Boolean);
}

function splitName(name: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return {};
  return {
    firstName: parts[0],
    ...(parts.length > 1 ? { lastName: parts.slice(1).join(" ") } : {}),
  };
}

function naturalCustomer(
  document: DomainDocument,
  clearMissingFields = false,
): NaturalCustomer | undefined {
  const person = document.relationships.person;
  if (!person || Array.isArray(person) || person.kind !== "individual")
    return undefined;
  const name = asRecord(person.attributes.name);
  const channels = asRecord(person.attributes.channels);
  const profile = asRecord(person.attributes.profile);
  const homeAddress = asRecord(profile.homeAddress);
  const input = {
    email:
      synchronizedString(channels.email, clearMissingFields) ??
      firstValue(channels.emails),
    firstName: synchronizedString(name.givenName, clearMissingFields),
    lastName: synchronizedString(name.familyName, clearMissingFields),
    phone: synchronizedString(channels.phone, clearMissingFields),
    address: synchronizedString(homeAddress.address, clearMissingFields),
    city: synchronizedString(homeAddress.city, clearMissingFields),
    state: synchronizedString(homeAddress.department, clearMissingFields),
  };
  return Object.values(input).some(Boolean) ? { input } : undefined;
}

function legalCustomer(
  document: DomainDocument,
  clearMissingFields = false,
): LegalCustomer | undefined {
  const organization = document.relationships.organization;
  if (
    !organization ||
    Array.isArray(organization) ||
    organization.kind !== "organization"
  )
    return undefined;
  const organizationAttributes = asRecord(organization.attributes.organization);
  const name = nonEmptyString(organizationAttributes.displayName);
  if (!name) return undefined;
  const contacts = organization.relationships.contacts;
  const contactList = Array.isArray(contacts)
    ? contacts
    : contacts
      ? [contacts]
      : [];
  const mainContact =
    contactList.find((contact) => asRecord(contact.attributes).main === true) ??
    contactList[0];
  const contactAttributes = mainContact ? asRecord(mainContact.attributes) : {};
  const representative = asRecord(organization.attributes.legalRepresentative);
  const parsedNameParts = splitName(
    nonEmptyString(representative.name) ??
      nonEmptyString(contactAttributes.name),
  );
  const nameParts = clearMissingFields
    ? {
        firstName: parsedNameParts.firstName ?? "",
        lastName: parsedNameParts.lastName ?? "",
      }
    : parsedNameParts;
  const contactEmail = synchronizedString(
    contactAttributes.email,
    clearMissingFields,
  );
  const contactPhone = synchronizedString(
    contactAttributes.phone,
    clearMissingFields,
  );
  return {
    company: {
      name,
      ...(contactPhone !== undefined ? { phone: contactPhone } : {}),
    },
    representative: Object.values(nameParts).some(Boolean)
      ? {
          ...nameParts,
          ...(contactEmail !== undefined ? { email: contactEmail } : {}),
          ...(contactPhone !== undefined ? { phone: contactPhone } : {}),
        }
      : undefined,
  };
}

function agencyIdFromDocument(document: DomainDocument): number | undefined {
  const agency = document.relationships.agency;
  if (!agency || Array.isArray(agency)) return undefined;
  const agencyId = Number(agency.id);
  return Number.isSafeInteger(agencyId) && agencyId > 0 ? agencyId : undefined;
}

function hubspotLink(
  portalId: string,
  objectKind: CustomerCrmObjectKind,
  objectId: string,
) {
  const objectType = objectKind === "contact" ? "0-1" : "0-2";
  return `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/record/${objectType}/${encodeURIComponent(objectId)}`;
}

function failed(
  customerId: number,
  reason: CustomerCrmSyncReason,
): CustomerCrmSyncItem {
  return { customerId, provider: hubspotProvider, status: "failed", reason };
}

function skipped(
  customerId: number,
  reason: CustomerCrmSyncReason,
): CustomerCrmSyncItem {
  return { customerId, provider: hubspotProvider, status: "skipped", reason };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrency, items.length) }, worker),
  );
  return results;
}

export function createCustomerCrmSyncService(
  dependencies: CustomerSyncDependencies,
) {
  async function customerFor(
    actor: AppActor,
    customerId: number,
  ): Promise<{ document: DomainDocument; agencyId: number } | undefined> {
    const document = await customerProfileDocument(dependencies.db, customerId);
    if (!document) return undefined;
    const agencyId = agencyIdFromDocument(document);
    if (
      !agencyId ||
      !(
        hasAgencyCapability(actor, agencyId, "customers:update") ||
        (dependencies.allowPlatformAdministration &&
          actor.globalRoles.includes("platform_admin"))
      )
    )
      throw new CrmConnectionAccessError(
        "The actor cannot synchronize this customer",
      );
    return { document, agencyId };
  }

  async function syncOne(
    actor: AppActor,
    customerId: number,
  ): Promise<CustomerCrmSyncItem> {
    const customer = await customerFor(actor, customerId);
    if (!customer) return skipped(customerId, "CUSTOMER_NOT_FOUND");
    const adapter = dependencies.adapters.hubspot;
    if (!adapter) return failed(customerId, "CRM_UNAVAILABLE");
    const connection = await dependencies.connections.findActiveConnection(
      customer.agencyId,
      hubspotProvider,
      actor.principal.id,
    );
    if (
      !connection ||
      connection.status !== "connected" ||
      !connection.externalAccountId
    )
      return failed(customerId, "CRM_CONNECTION_NOT_READY");

    const natural = naturalCustomer(
      customer.document,
      dependencies.clearMissingFields,
    );
    const legal = natural
      ? undefined
      : legalCustomer(customer.document, dependencies.clearMissingFields);
    if (!natural && !legal) return skipped(customerId, "CUSTOMER_NOT_SYNCABLE");
    const objectKind: CustomerCrmObjectKind = natural ? "contact" : "company";

    try {
      if (natural) {
        const mapped = await dependencies.mappings.find(
          customer.agencyId,
          customerId,
          hubspotProvider,
          "contact",
          actor.principal.id,
        );
        let contactId: string;
        let status: "created" | "updated";
        if (mapped) {
          const contact = await adapter.updateContact(
            connection,
            mapped.externalObjectId,
            natural.input,
          );
          contactId = contact.id;
          status = "updated";
        } else {
          const matches = natural.input.email
            ? await adapter.findContactByEmail(connection, natural.input.email)
            : [];
          if (matches.length > 1)
            return skipped(customerId, "AMBIGUOUS_CONTACT");
          const contact = matches[0]
            ? await adapter.updateContact(
                connection,
                matches[0].id,
                natural.input,
              )
            : await adapter.createContact(connection, natural.input);
          contactId = contact.id;
          status = matches[0] ? "updated" : "created";
        }
        await dependencies.mappings.upsertSuccess({
          principalId: actor.principal.id,
          agencyId: customer.agencyId,
          customerProfileId: customerId,
          provider: hubspotProvider,
          objectKind: "contact",
          externalObjectId: contactId,
        });
        return {
          customerId,
          provider: hubspotProvider,
          status,
          primaryLink: {
            provider: hubspotProvider,
            objectKind: "contact",
            url: hubspotLink(
              connection.externalAccountId,
              "contact",
              contactId,
            ),
          },
        };
      }

      if (!legal) return skipped(customerId, "CUSTOMER_NOT_SYNCABLE");
      const mappedCompany = await dependencies.mappings.find(
        customer.agencyId,
        customerId,
        hubspotProvider,
        "company",
        actor.principal.id,
      );
      let companyId: string;
      let status: "created" | "updated";
      if (mappedCompany) {
        const company = await adapter.updateCompany(
          connection,
          mappedCompany.externalObjectId,
          legal.company,
        );
        companyId = company.id;
        status = "updated";
      } else {
        const matches = await adapter.findCompanyByName(
          connection,
          legal.company.name,
        );
        if (matches.length > 1) return skipped(customerId, "AMBIGUOUS_COMPANY");
        const company = matches[0]
          ? await adapter.updateCompany(
              connection,
              matches[0].id,
              legal.company,
            )
          : await adapter.createCompany(connection, legal.company);
        companyId = company.id;
        status = matches[0] ? "updated" : "created";
      }
      await dependencies.mappings.upsertSuccess({
        principalId: actor.principal.id,
        agencyId: customer.agencyId,
        customerProfileId: customerId,
        provider: hubspotProvider,
        objectKind: "company",
        externalObjectId: companyId,
      });

      if (legal.representative) {
        const mappedRepresentative = await dependencies.mappings.find(
          customer.agencyId,
          customerId,
          hubspotProvider,
          "contact",
          actor.principal.id,
        );
        const contact = mappedRepresentative
          ? await adapter.updateContact(
              connection,
              mappedRepresentative.externalObjectId,
              legal.representative,
            )
          : await adapter.createContact(connection, {
              ...legal.representative,
              companyId,
            });
        await dependencies.mappings.upsertSuccess({
          principalId: actor.principal.id,
          agencyId: customer.agencyId,
          customerProfileId: customerId,
          provider: hubspotProvider,
          objectKind: "contact",
          externalObjectId: contact.id,
        });
      }
      return {
        customerId,
        provider: hubspotProvider,
        status,
        primaryLink: {
          provider: hubspotProvider,
          objectKind: "company",
          url: hubspotLink(connection.externalAccountId, "company", companyId),
        },
      };
    } catch (exception) {
      const reason =
        exception instanceof CrmUpstreamError &&
        exception.code === "RECONNECT_REQUIRED"
          ? "CRM_RECONNECT_REQUIRED"
          : "UPSTREAM_FAILURE";
      if (reason === "CRM_RECONNECT_REQUIRED") {
        await dependencies.connections.markReconnectRequired(
          connection.id,
          actor.principal.id,
        );
        await dependencies.connections.appendAuditEvent({
          connectionId: connection.id,
          agencyId: customer.agencyId,
          principalId: actor.principal.id,
          provider: hubspotProvider,
          eventType: "operation_reconnect_required",
          outcome: "failure",
          errorCode: "RECONNECT_REQUIRED",
        });
      }
      await dependencies.mappings.recordFailure({
        principalId: actor.principal.id,
        agencyId: customer.agencyId,
        customerProfileId: customerId,
        provider: hubspotProvider,
        objectKind,
        failureCode: reason,
      });
      return failed(customerId, reason);
    }
  }

  return {
    async syncCustomers(input: { actor: AppActor; customerIds: number[] }) {
      const customerIds = [...new Set(input.customerIds)];
      const items = await mapWithConcurrency(customerIds, (customerId) =>
        syncOne(input.actor, customerId),
      );
      const summary: CustomerCrmSyncResponse["summary"] = {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      for (const item of items) summary[item.status] += 1;
      return { items, summary } satisfies CustomerCrmSyncResponse;
    },

    async listLinks(input: { actor: AppActor; customerIds: number[] }) {
      const customerIds = [...new Set(input.customerIds)];
      const links = await mapWithConcurrency(
        customerIds,
        async (customerId): Promise<CustomerCrmLink | undefined> => {
          const customer = await customerFor(input.actor, customerId);
          if (!customer) return undefined;
          const connection =
            await dependencies.connections.findActiveConnection(
              customer.agencyId,
              hubspotProvider,
              input.actor.principal.id,
            );
          if (
            !connection ||
            connection.status !== "connected" ||
            !connection.externalAccountId
          )
            return undefined;
          const objectKind: CustomerCrmObjectKind = naturalCustomer(
            customer.document,
          )
            ? "contact"
            : legalCustomer(customer.document)
              ? "company"
              : "contact";
          const mapping = await dependencies.mappings.find(
            customer.agencyId,
            customerId,
            hubspotProvider,
            objectKind,
            input.actor.principal.id,
          );
          if (!mapping) return undefined;
          return {
            customerId,
            provider: hubspotProvider,
            objectKind,
            url: hubspotLink(
              connection.externalAccountId,
              objectKind,
              mapping.externalObjectId,
            ),
          } satisfies CustomerCrmLink;
        },
      );
      return links.filter(
        (link): link is CustomerCrmLink => link !== undefined,
      );
    },
  };
}
