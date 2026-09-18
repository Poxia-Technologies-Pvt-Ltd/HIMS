// Reads a photographed bill/prescription with Ollama Cloud's vision model and
// turns it into structured patient fields + a set of lab_tests matched from
// the real catalog — used by the public "upload your prescription" auto-bill
// flow (routes/publicUploadRoutes.js). Talks to Ollama's hosted cloud API
// directly (not a local model — nothing to keep warm/GPU'd on this box), so
// this only ever runs where OLLAMA_API_KEY is set.
const OLLAMA_API_URL = 'https://ollama.com/api/chat';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:31b-cloud';

// Keep the model from inventing tests: it may only pick from this list, and
// must echo back the exact test_code so we can look the row up ourselves —
// never trust a name/price the model writes.
function buildCatalogBlock(catalog) {
  return catalog.map((t) => `${t.test_code} | ${t.test_name}`).join('\n');
}

const SYSTEM_PROMPT = `You are reading a photo of a patient's medical prescription or an existing lab bill/receipt to help a lab pre-fill a billing form. Extract ONLY what is legible in the image — never guess or invent a value.

Return STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "title": string|null,
  "first_name": string|null,
  "middle_name": string|null,
  "last_name": string|null,
  "dob": string|null,            // ISO yyyy-mm-dd if a date of birth is printed
  "age_years": number|null,
  "age_months": number|null,
  "age_days": number|null,
  "gender": "Male"|"Female"|"Other"|null,
  "phone": string|null,          // digits only
  "patient_type": "OP"|"IP"|"Emergency"|null,
  "consultant_name": string|null,
  "source_facility": string|null, // the hospital/lab/clinic name printed on the document, if any (letterhead, stamp, logo text)
  "matched_test_codes": string[],   // test_code values, ONLY from the catalog list given below, for every test/investigation you can identify in the image
  "unmatched_lines": string[]       // any test/investigation text you can read in the image that does NOT correspond to any catalog entry — copy the raw text as printed
}

Rules:
- matched_test_codes must only contain codes copied verbatim from the catalog list below. Never output a code not in that list.
- If a line in the image names a test but you are not confident which catalog entry (if any) it maps to, put the raw text in unmatched_lines instead of guessing a code.
- If the image contains no identifiable test/investigation names at all, leave matched_test_codes empty.
- Leave any field null/empty if it is not legible or not present — do not fabricate.

Catalog (test_code | test_name):
`;

async function callOllama(imageBase64, catalog) {
  const prompt = SYSTEM_PROMPT + buildCatalogBlock(catalog);
  const res = await fetch(OLLAMA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
      stream: false,
      format: 'json',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    // Model occasionally wraps JSON in stray text despite format:'json' — pull
    // out the first {...} block as a fallback rather than failing outright.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Ollama did not return parseable JSON');
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}

// catalog: [{test_code, test_name}]. Returns the raw parsed model output —
// caller (publicUploadController) is responsible for re-validating
// matched_test_codes against the real catalog before trusting them for
// billing (the model is asked to only pick from the list, but nothing here
// enforces that — this module hands back the model's claim, not verified data).
export async function extractPrescriptionData(imageBase64, catalog) {
  if (!process.env.OLLAMA_API_KEY) {
    throw new Error('OLLAMA_API_KEY not configured');
  }
  return callOllama(imageBase64, catalog);
}
