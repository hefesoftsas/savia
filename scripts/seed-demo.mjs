import { fileURLToPath } from "node:url";

export const DEMO_TENANT = { idSlug: "demo", name: "Agencia Demo" };

export const DEMO_CUSTOMERS = [
  { name: "Cliente Demo Uno" },
  { name: "Cliente Demo Dos" },
  { name: "Cliente Demo Tres" },
];

export function extractSessionCookie(setCookies) {
  const list = Array.isArray(setCookies)
    ? setCookies
    : String(setCookies ?? "")
        .split(/,(?=[^;,]+=[^;,]*)/)
        .map((part) => part.trim())
        .filter(Boolean);
  const pairs = list
    .map((entry) => entry.split(";")[0].trim())
    .filter((pair) => pair.includes("="));
  if (pairs.length === 0) throw new Error("Sign-in returned no session cookie");
  return pairs.join("; ");
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (
    index === -1 ||
    index + 1 >= argv.length ||
    argv[index + 1].startsWith("--")
  )
    throw new Error(`Missing required flag: ${flag} <value>`);
  return argv[index + 1];
}

async function api(origin, cookie, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok)
    throw new Error(
      `${path} -> HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  return payload;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log(
      "Usage: node scripts/seed-demo.mjs --origin https://domain --email <admin> --password <pw> [--dry-run]",
    );
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const origin = flagValue(argv, "--origin").replace(/\/$/, "");
  const email = flagValue(argv, "--email");
  const password = flagValue(argv, "--password");

  console.log(`Seed plan for ${origin}:`);
  console.log(`  1. sign in as ${email}`);
  console.log(`  2. create tenant ${DEMO_TENANT.idSlug}`);
  console.log(`  3. bootstrap + install savia.insurance`);
  console.log(`  4. create ${DEMO_CUSTOMERS.length} sample clientes`);
  if (dryRun) return;

  const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok)
    throw new Error(
      `sign-in -> HTTP ${signIn.status}: ${(await signIn.text()).slice(0, 200)}`,
    );
  const cookie = extractSessionCookie(
    typeof signIn.headers.getSetCookie === "function"
      ? signIn.headers.getSetCookie()
      : (signIn.headers.get("set-cookie") ?? ""),
  );
  console.log("signed in");

  const tenant = (await api(origin, cookie, "/v1/tenants", DEMO_TENANT))?.data;
  if (!tenant?.id) throw new Error("tenant creation returned no id");
  const base = `/v1/studio/${tenant.id}/api`;
  console.log(`tenant ${tenant.id}`);

  await api(origin, cookie, `${base}/bootstrap`);
  const catalog = await api(origin, cookie, `${base}/solutions`);
  const manifest = (catalog?.data ?? []).find(
    (entry) => entry?.manifest?.id === "savia.insurance",
  )?.manifest;
  if (!manifest)
    throw new Error("savia.insurance not found in solutions catalog");
  await api(origin, cookie, `${base}/solutions/install`, manifest);
  console.log("installed savia.insurance");

  for (const customer of DEMO_CUSTOMERS) {
    await api(origin, cookie, `${base}/records/clientes`, customer);
  }
  console.log(`created ${DEMO_CUSTOMERS.length} sample clientes`);
  console.log("Demo seed complete.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
