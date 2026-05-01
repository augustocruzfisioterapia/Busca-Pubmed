const LOCAL_DESCRIPTORS = [
  {
    label: "Mobilização precoce",
    terms: ["mobilização precoce", "mobilizacao precoce", "deambulação precoce", "deambulacao precoce", "early mobilization", "early mobility", "early ambulation"],
    mesh: ["Early Ambulation"],
    english: ["early mobilization", "early mobility", "early ambulation"]
  },
  {
    label: "Unidade de terapia intensiva",
    terms: ["unidade de terapia intensiva", "unidade de cuidados intensivos", "terapia intensiva", "uti", "icu", "intensive care unit", "intensive care units"],
    mesh: ["Intensive Care Units"],
    english: ["intensive care unit", "intensive care units", "ICU"]
  },
  {
    label: "DPOC - Doença pulmonar obstrutiva crônica",
    terms: ["dpoc", "doença pulmonar obstrutiva crônica", "doenca pulmonar obstrutiva cronica", "copd", "chronic obstructive pulmonary disease"],
    mesh: ["Pulmonary Disease, Chronic Obstructive"],
    english: ["COPD", "chronic obstructive pulmonary disease", "chronic obstructive lung disease"]
  },
  {
    label: "VNI - Ventilação não invasiva",
    terms: ["vni", "ventilação não invasiva", "ventilacao nao invasiva", "niv", "noninvasive ventilation", "non-invasive ventilation"],
    mesh: ["Noninvasive Ventilation"],
    english: ["noninvasive ventilation", "non-invasive ventilation", "NIV"]
  },
  {
    label: "EAP - Edema agudo de pulmão",
    terms: ["eap", "edema agudo de pulmão", "edema agudo de pulmao", "edema pulmonar agudo", "acute pulmonary edema", "pulmonary edema"],
    mesh: ["Pulmonary Edema"],
    english: ["acute pulmonary edema", "pulmonary edema"]
  },
  {
    label: "Doença crítica",
    terms: ["paciente crítico", "paciente critico", "pacientes críticos", "pacientes criticos", "doença crítica", "doenca critica", "critical illness", "critically ill"],
    mesh: ["Critical Illness"],
    english: ["critical illness", "critically ill"]
  },
  {
    label: "Segurança",
    terms: ["segurança", "seguranca", "eventos adversos", "evento adverso", "efeitos adversos", "safety", "adverse events", "adverse effects"],
    mesh: ["Patient Safety"],
    english: ["safety", "adverse events", "adverse effects", "feasibility"]
  },
  {
    label: "Ventilação mecânica",
    terms: ["ventilação mecânica", "ventilacao mecanica", "respiração artificial", "respiracao artificial", "mechanical ventilation", "artificial respiration"],
    mesh: ["Respiration, Artificial"],
    english: ["mechanical ventilation", "artificial respiration"]
  },
  {
    label: "Desmame ventilatório",
    terms: ["desmame ventilatório", "desmame ventilatorio", "retirada da ventilação", "retirada da ventilacao", "weaning", "ventilator weaning"],
    mesh: ["Ventilator Weaning"],
    english: ["ventilator weaning", "weaning"]
  },
  {
    label: "Fisioterapia",
    terms: ["fisioterapia", "fisioterapia intensiva", "physical therapy", "physiotherapy"],
    mesh: ["Physical Therapy Modalities"],
    english: ["physical therapy", "physiotherapy"]
  },
  {
    label: "Reabilitação",
    terms: ["reabilitação", "reabilitacao", "rehabilitation"],
    mesh: ["Rehabilitation"],
    english: ["rehabilitation"]
  },
  {
    label: "Fraqueza adquirida na UTI",
    terms: ["fraqueza adquirida na uti", "fraqueza muscular adquirida na uti", "icu acquired weakness", "intensive care unit acquired weakness"],
    mesh: [],
    english: ["ICU acquired weakness", "intensive care unit acquired weakness", "muscle weakness"]
  },
  {
    label: "Força muscular",
    terms: ["força muscular", "forca muscular", "muscle strength"],
    mesh: ["Muscle Strength"],
    english: ["muscle strength"]
  },
  {
    label: "Mortalidade",
    terms: ["mortalidade", "óbito", "obito", "morte", "mortality", "death"],
    mesh: ["Mortality"],
    english: ["mortality", "death"]
  },
  {
    label: "Tempo de internação",
    terms: ["tempo de internação", "tempo de internacao", "tempo de permanência", "tempo de permanencia", "length of stay"],
    mesh: ["Length of Stay"],
    english: ["length of stay", "hospital length of stay", "ICU length of stay"]
  },
  {
    label: "Síndrome do desconforto respiratório agudo",
    terms: ["síndrome do desconforto respiratório agudo", "sindrome do desconforto respiratorio agudo", "sdra", "ards", "acute respiratory distress syndrome"],
    mesh: ["Acute Respiratory Distress Syndrome"],
    english: ["acute respiratory distress syndrome", "ARDS"]
  },
  {
    label: "PEEP",
    terms: ["peep", "pressão positiva expiratória final", "pressao positiva expiratoria final", "positive end expiratory pressure"],
    mesh: ["Positive-Pressure Respiration"],
    english: ["PEEP", "positive end-expiratory pressure"]
  },
  {
    label: "Recrutamento pulmonar",
    terms: ["recrutamento pulmonar", "recrutabilidade pulmonar", "lung recruitment", "lung recruitability", "recruitability"],
    mesh: [],
    english: ["lung recruitment", "lung recruitability", "recruitability"]
  },
  {
    label: "Oxigenação",
    terms: ["oxigenação", "oxigenacao", "oxygenation"],
    mesh: ["Oxygenation"],
    english: ["oxygenation"]
  },
  {
    label: "Exercício",
    terms: ["exercício", "exercicio", "exercícios", "exercicios", "exercise", "therapeutic exercise"],
    mesh: ["Exercise Therapy"],
    english: ["exercise", "therapeutic exercise", "exercise therapy"]
  }
];

const STOPWORDS = new Set([
  "a", "as", "o", "os", "e", "em", "na", "no", "nas", "nos", "de", "da", "do", "das", "dos",
  "para", "por", "com", "sem", "sobre", "entre", "ao", "aos", "à", "às", "um", "uma", "uns", "umas"
]);

export function resolveSearchConcepts(searchText = "") {
  const raw = String(searchText).trim();
  if (!raw) return { concepts: [], notes: [] };

  const explicitParts = raw
    .split(/\s*(?:[\n;,]+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parts = explicitParts.length > 1 ? explicitParts : extractKnownParts(raw);
  const concepts = [];
  const seen = new Set();

  for (const part of parts) {
    const descriptor = findDescriptor(part);
    const key = descriptor ? descriptor.label : normalizeKey(part);
    if (seen.has(key)) continue;
    seen.add(key);

    if (descriptor) {
      concepts.push({
        original: part,
        label: descriptor.label,
        mesh: descriptor.mesh,
        english: descriptor.english,
        titleAbstract: unique([part, ...descriptor.terms, ...descriptor.english]),
        source: "Base local DeCS/MeSH"
      });
    } else {
      concepts.push({
        original: part,
        label: part,
        mesh: [],
        english: [],
        titleAbstract: [part],
        source: "Termo livre"
      });
    }
  }

  return {
    concepts,
    notes: [
      "Quando o termo em português está na base local, a busca inclui descritores/termos equivalentes em inglês.",
      "A API oficial completa do DeCS exige licença; esta versão usa uma base local inicial e auditável."
    ]
  };
}

export function hasPortugueseSignal(value = "") {
  const text = normalizeKey(value);
  return /[áàâãéêíóôõúç]/i.test(value) || LOCAL_DESCRIPTORS.some((item) =>
    item.terms.some((term) => normalizeKey(term) !== term.toLowerCase() && text.includes(normalizeKey(term)))
  );
}

function extractKnownParts(raw) {
  const normalized = normalizeKey(raw);
  const matches = [];

  for (const descriptor of LOCAL_DESCRIPTORS) {
    const matchedTerm = descriptor.terms
      .map((term) => ({ term, key: normalizeKey(term) }))
      .sort((a, b) => b.key.length - a.key.length)
      .find(({ key }) => key && normalized.includes(key));

    if (matchedTerm) {
      matches.push({ term: matchedTerm.term, key: matchedTerm.key, index: normalized.indexOf(matchedTerm.key) });
    }
  }

  if (matches.length === 0) return [raw];

  matches.sort((a, b) => a.index - b.index);
  const known = matches.map((match) => match.term);
  const leftovers = normalized
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .filter((word) => !matches.some((match) => match.key.split(/\s+/).includes(word)));

  return unique([...known, ...leftovers]);
}

function findDescriptor(value) {
  const key = normalizeKey(value);
  return LOCAL_DESCRIPTORS.find((descriptor) =>
    descriptor.terms.some((term) => {
      const termKey = normalizeKey(term);
      return key === termKey || key.includes(termKey) || termKey.includes(key);
    })
  );
}

function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  const seen = new Set();
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
