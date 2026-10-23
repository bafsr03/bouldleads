// Meta Instant Form leads, from Leads Center → Download (spec v2 Part 4: a manual CSV import until
// Meta lead webhooks are connected). Meta's export is often UTF-16 and tab-separated, phones come
// as "p:+18015551234", and custom questions are columns named after the question text.

export type MetaLead = {
  metaId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  business: string | null;
  city: string | null;
  service: string | null;
  campaign: string | null;
  ad: string | null;
  createdAt: string | null;
};

/** Text from the uploaded file's bytes: UTF-16 (with or without BOM) or UTF-8. */
export function decodeCsv(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  // UTF-16LE without a BOM: every other byte of ASCII text is zero.
  if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) return new TextDecoder("utf-16le").decode(buf);
  return new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "");
}

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes; comma or tab, from the header. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n/) >>> 0 || text.length);
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which column holds what. Custom questions are matched by the words in them. */
export function mapHeaders(headers: string[]) {
  const h = headers.map(norm);
  const find = (...tests: ((x: string) => boolean)[]) => {
    for (const t of tests) {
      const i = h.findIndex(t);
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    id: find((x) => x === "id" || x === "lead id"),
    name: find((x) => x === "full name" || x === "name"),
    first: find((x) => x === "first name"),
    last: find((x) => x === "last name"),
    phone: find((x) => x === "phone number" || x === "phone"),
    email: find((x) => x === "email" || x === "email address"),
    business: find((x) => /\b(business|company)\b/.test(x)),
    city: find((x) => /\bcity\b/.test(x), (x) => /\b(location|town)\b/.test(x)),
    service: find((x) => /what (do )?you do/.test(x), (x) => /\b(service|industry|trade|type of business)\b/.test(x)),
    campaign: find((x) => x === "campaign name"),
    ad: find((x) => x === "ad name"),
    created: find((x) => x === "created time"),
  };
}

const val = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() || null : null);

/** "p:+18015551234" → "+18015551234" (Meta prefixes phone numbers so spreadsheets keep the +). */
export const metaPhone = (p: string | null) => (p ? p.replace(/^p:/i, "").trim() || null : null);

export function parseMetaLeads(text: string): { leads: MetaLead[]; missing: string[] } {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { leads: [], missing: ["header row"] };
  const m = mapHeaders(header);
  const missing = [m.business < 0 && "business name", m.city < 0 && "city", m.phone < 0 && "phone number"].filter((x): x is string => !!x);
  const leads = rows.map((r) => ({
    metaId: val(r, m.id),
    name: val(r, m.name) ?? ([val(r, m.first), val(r, m.last)].filter(Boolean).join(" ") || null),
    phone: metaPhone(val(r, m.phone)),
    email: val(r, m.email),
    business: val(r, m.business),
    city: val(r, m.city),
    service: val(r, m.service),
    campaign: val(r, m.campaign),
    ad: val(r, m.ad),
    createdAt: val(r, m.created),
  }));
  return { leads, missing };
}
