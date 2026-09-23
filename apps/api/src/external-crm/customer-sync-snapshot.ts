import type { DomainDocument } from "../domains/contracts";

type CustomerRow = {
  id: number;
  agency_id: number;
  natural_id: number | null;
  natural_name: string | null;
  natural_surname: string | null;
  natural_email: string | null;
  natural_phone: string | null;
  natural_address: string | null;
  legal_id: number | null;
  legal_name: string | null;
  legal_representative_name: string | null;
};

type ContactRow = {
  name: string;
  surname: string;
  email: string;
  phone: string;
  is_main: number;
};

/**
 * The automatic CRM worker only needs a stable, read-only customer projection.
 * Keeping it here avoids coupling the Core worker to the Legacy domain runtime.
 */
export async function customerProfileDocument(
  db: D1Database,
  customerId: number,
): Promise<DomainDocument | undefined> {
  const row = await db
    .prepare(
      `SELECT
        profile.id,
        profile.agency_id,
        np.id AS natural_id,
        np.name AS natural_name,
        np.surname AS natural_surname,
        np.email AS natural_email,
        np.phone AS natural_phone,
        address.address AS natural_address,
        lp.id AS legal_id,
        lp.name AS legal_name,
        lp.lr_name AS legal_representative_name
      FROM customer_clientagency profile
      LEFT JOIN customer_naturalperson np ON np.client_id=profile.id
      LEFT JOIN customer_address address ON address.id=np.home_address_id
      LEFT JOIN customer_legalperson lp ON lp.client_id=profile.id
      WHERE profile.id=?
      ORDER BY np.id DESC, lp.id DESC
      LIMIT 1`,
    )
    .bind(customerId)
    .first<CustomerRow>();
  if (!row) return undefined;

  const agency = {
    id: String(row.agency_id),
    kind: "agency",
    attributes: {},
    relationships: {},
  };
  if (row.natural_id !== null) {
    return {
      id: String(row.id),
      kind: "customer-profile",
      attributes: {},
      relationships: {
        agency,
        person: {
          id: String(row.natural_id),
          kind: "individual",
          attributes: {
            name: {
              givenName: row.natural_name ?? "",
              familyName: row.natural_surname ?? "",
            },
            channels: {
              email: row.natural_email ?? "",
              phone: row.natural_phone ?? "",
            },
            profile: {
              homeAddress: { address: row.natural_address ?? "" },
            },
          },
          relationships: {},
        },
      },
    };
  }
  if (row.legal_id === null || !row.legal_name) return undefined;
  const contact = await db
    .prepare(
      `SELECT name,surname,email,phone,is_main
       FROM customer_legalpersoncontact
       WHERE legal_person_id=?
       ORDER BY is_main DESC,id ASC
       LIMIT 1`,
    )
    .bind(row.legal_id)
    .first<ContactRow>();
  return {
    id: String(row.id),
    kind: "customer-profile",
    attributes: {},
    relationships: {
      agency,
      organization: {
        id: String(row.legal_id),
        kind: "organization",
        attributes: {
          organization: { displayName: row.legal_name },
          legalRepresentative: { name: row.legal_representative_name ?? "" },
        },
        relationships: {
          contacts: contact
            ? {
                id: String(row.legal_id),
                kind: "contact",
                attributes: {
                  name: [contact.name, contact.surname]
                    .filter(Boolean)
                    .join(" "),
                  email: contact.email,
                  phone: contact.phone,
                  main: contact.is_main === 1,
                },
                relationships: {},
              }
            : [],
        },
      },
    },
  };
}
