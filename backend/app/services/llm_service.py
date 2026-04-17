from openai import AsyncOpenAI
from app.core.config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)

# ── TCF System Prompts ──

TCF_SYSTEM_PROMPT = """Tu es un examinateur bienveillant pour l'examen TCF (Test de Connaissance du Français) – épreuve d'expression orale.
Tu mènes une conversation naturelle en français avec le candidat pour évaluer ses compétences orales.

Règles:
- Parle uniquement en français
- Adapte ton niveau au niveau du candidat (A1-C2)
- Pose des questions ouvertes pour encourager le candidat à parler
- Ne corrige PAS les erreurs pendant la conversation — tu évalues seulement
- Simule les conditions réelles d'examen TCF
- Garde tes réponses concises (2-3 phrases max) pour laisser le candidat parler
- Sois naturel et encourageant, comme un vrai examinateur"""

TCF_PART_INSTRUCTIONS = {
    1: "Tu es en Tâche 1 (Entretien dirigé). Pose des questions personnelles simples: nom, nationalité, profession, famille, loisirs, habitudes quotidiennes. Niveau {level}. Durée: 2 minutes.",
    2: "Tu es en Tâche 2 (Interaction). Propose un jeu de rôle réaliste de la vie quotidienne (acheter un billet, réserver un hôtel, se renseigner, faire une réclamation). Tu joues le rôle de l'interlocuteur. Niveau {level}. Durée: 5 minutes 30.",
    3: "Tu es en Tâche 3 (Expression d'un point de vue). Propose un sujet de société (environnement, technologie, éducation, travail) et demande au candidat de donner et défendre son point de vue avec des arguments structurés. Niveau {level}. Durée: 4 minutes 30.",
}

# ── TEF System Prompts ──

TEF_SYSTEM_PROMPT = """Tu es un examinateur bienveillant pour l'examen TEF Canada (Test d'Évaluation de Français) – épreuve d'expression orale.
Tu mènes une conversation naturelle en français avec le candidat pour évaluer ses compétences orales.

Règles:
- Parle uniquement en français
- Adapte ton niveau au niveau du candidat (A1-C2)
- Pose des questions ouvertes pour encourager le candidat à parler
- Ne corrige PAS les erreurs pendant la conversation — tu évalues seulement
- Simule les conditions réelles d'examen TEF Canada
- Garde tes réponses concises (2-3 phrases max) pour laisser le candidat parler
- Sois naturel et encourageant, comme un vrai examinateur"""

TEF_PART_INSTRUCTIONS = {
    1: "Tu es en Section A (Demande de renseignements / Prise de position). Propose une situation où le candidat doit obtenir des informations et donner son opinion (ex: choisir un logement, comparer des offres). Niveau {level}. Durée: 5 minutes.",
    2: "Tu es en Section B (Argumentation). Propose un sujet controversé et demande au candidat de présenter des arguments pour et contre, puis de défendre sa position. Tu peux jouer le rôle de l'avocat du diable. Niveau {level}. Durée: 10 minutes.",
}

EXAM_PROMPTS = {
    "tcf": {"system": TCF_SYSTEM_PROMPT, "parts": TCF_PART_INSTRUCTIONS},
    "tef": {"system": TEF_SYSTEM_PROMPT, "parts": TEF_PART_INSTRUCTIONS},
}


async def get_conversation_response(
    messages: list[dict], exam_type: str = "tcf", exam_part: int = 1, level: str = "B1"
) -> str:
    """Generate examiner response based on conversation history."""
    prompts = EXAM_PROMPTS.get(exam_type, EXAM_PROMPTS["tcf"])
    system_prompt = prompts["system"]
    part_instructions = prompts["parts"]

    part_text = part_instructions.get(exam_part, list(part_instructions.values())[0])
    part_text = part_text.format(level=level)

    system_message = system_prompt + "\n\n" + part_text

    full_messages = [{"role": "system", "content": system_message}] + messages

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=full_messages,
        max_tokens=200,
        temperature=0.7,
    )

    return response.choices[0].message.content


async def evaluate_response(user_text: str, context: str, level: str = "B1") -> dict:
    """Evaluate user's French response for grammar, vocabulary, and coherence."""
    eval_prompt = f"""Évalue la réponse suivante d'un candidat niveau {level} au TCF/TEF.

Contexte de la conversation: {context}
Réponse du candidat: {user_text}

Donne une évaluation JSON avec:
- grammar_score (0-100)
- vocabulary_score (0-100)
- coherence_score (0-100)
- corrections (liste de corrections si nécessaire)
- feedback (un conseil bref en français)

Réponds uniquement en JSON valide."""

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": eval_prompt}],
        max_tokens=300,
        temperature=0.3,
    )

    import json, re
    raw = response.choices[0].message.content or ""
    # Strip markdown code fences if present (```json ... ```)
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {
            "grammar_score": 0,
            "vocabulary_score": 0,
            "coherence_score": 0,
            "corrections": [],
            "feedback": "Évaluation non disponible.",
        }


async def generate_session_review(transcript: list[dict], exam_type: str = "tcf", level: str = "B1") -> str:
    """Generate a comprehensive AI review of the entire session."""
    exam_label = "TCF" if exam_type == "tcf" else "TEF Canada"
    
    transcript_text = "\n".join(
        f"{'Examinateur' if m['role'] == 'assistant' else 'Candidat'}: {m['content']}"
        for m in transcript
    )

    review_prompt = f"""You are an expert assessor for the {exam_label} French speaking exam.
Here is the full speaking-session transcript for a candidate targeting level {level}:

{transcript_text}

Write a detailed, constructive review in English (200-300 words) using Markdown.

Required sections:
1. **Strengths**: What the candidate does well
2. **Areas to Improve**: Weaknesses with concrete examples from the transcript
3. **Recurring Errors**: Grammar, vocabulary, or pronunciation patterns
4. **Personalized Advice**: 3-4 concrete improvement actions
5. **Estimated CEFR Level**: A1-C2 estimate based on this performance

Style rules:
- Output must be in English only.
- Be encouraging but honest.
- Keep feedback specific and actionable.
"""

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": review_prompt}],
        max_tokens=600,
        temperature=0.4,
        timeout=90,
    )

    return response.choices[0].message.content


async def generate_session_scores(transcript: list[dict], level: str = "B1") -> dict:
    """Generate aggregate text-based session scores and corrections from transcript."""
    transcript_text = "\n".join(
        f"{'Examiner' if m.get('role') == 'assistant' else 'Candidate'}: {m.get('content', '')}"
        for m in transcript
        if isinstance(m, dict)
    )

    scoring_prompt = f"""You are an expert French-speaking examiner.
Evaluate this full transcript for a level-{level} candidate.

Transcript:
{transcript_text}

Return ONLY valid JSON with this exact shape:
{{
  "grammar_score": number (0-100),
  "vocabulary_score": number (0-100),
  "coherence_score": number (0-100),
  "corrections": [
    {{"text": "specific correction"}},
    {{"feedback": "short actionable advice"}}
  ]
}}

Rules:
- No markdown, no code fences.
- Keep corrections concise and specific.
- If unsure, still provide best estimate scores.
"""

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": scoring_prompt}],
        max_tokens=450,
        temperature=0.2,
        timeout=90,
    )

    import json, re

    raw = response.choices[0].message.content or ""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return {
            "grammar_score": None,
            "vocabulary_score": None,
            "coherence_score": None,
            "corrections": [],
        }

    def _norm_score(value):
        try:
            num = float(value)
        except (TypeError, ValueError):
            return None
        return max(0.0, min(100.0, round(num, 1)))

    corrections = parsed.get("corrections") or []
    if not isinstance(corrections, list):
        corrections = []

    normalized_corrections = []
    for item in corrections:
        if isinstance(item, str):
            normalized_corrections.append({"text": item})
        elif isinstance(item, dict):
            normalized_corrections.append(item)

    return {
        "grammar_score": _norm_score(parsed.get("grammar_score")),
        "vocabulary_score": _norm_score(parsed.get("vocabulary_score")),
        "coherence_score": _norm_score(parsed.get("coherence_score")),
        "corrections": normalized_corrections,
    }
