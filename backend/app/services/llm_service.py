from openai import AsyncOpenAI
from app.core.config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)

SYSTEM_PROMPT = """Tu es un examinateur bienveillant pour les examens TCF/TEF de français.
Tu mènes une conversation naturelle en français avec le candidat pour évaluer ses compétences orales.

Règles:
- Parle uniquement en français
- Adapte ton niveau au niveau du candidat (A1-C2)
- Pose des questions ouvertes pour encourager le candidat à parler
- Corrige poliment les erreurs importantes
- Simule les conditions d'examen TCF/TEF
- Garde tes réponses concises (2-3 phrases max) pour laisser le candidat parler

Parties de l'examen oral TCF/TEF:
- Partie 1: Entretien dirigé - Questions personnelles simples (nom, profession, loisirs)
- Partie 2: Exercice en interaction - Jeu de rôle (situation quotidienne)
- Partie 3: Expression d'un point de vue - Discussion sur un sujet de société
"""


async def get_conversation_response(
    messages: list[dict], exam_part: int = 1, level: str = "B1"
) -> str:
    """Generate examiner response based on conversation history."""
    part_instructions = {
        1: f"Tu es en Partie 1 (Entretien dirigé). Pose des questions personnelles simples adaptées au niveau {level}.",
        2: f"Tu es en Partie 2 (Exercice en interaction). Propose un jeu de rôle de la vie quotidienne adapté au niveau {level}.",
        3: f"Tu es en Partie 3 (Expression d'un point de vue). Propose un sujet de société et demande l'avis du candidat, adapté au niveau {level}.",
    }

    system_message = SYSTEM_PROMPT + "\n\n" + part_instructions.get(exam_part, part_instructions[1])

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

    import json
    try:
        return json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return {
            "grammar_score": 0,
            "vocabulary_score": 0,
            "coherence_score": 0,
            "corrections": [],
            "feedback": "Évaluation non disponible.",
        }
