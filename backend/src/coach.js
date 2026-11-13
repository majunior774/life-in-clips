/** Voice coach persona, the single narrow tool it may call, and the Gemini Live session config. */
import { Modality, Type } from '@google/genai';
import { config } from './config.js';

export const PROPOSE_PLAN_DECLARATION = {
  name: 'propose_plan',
  description:
    'Show the user a reviewable plan: one movie (a goal) with its clips (small actionable tasks). ' +
    'This does NOT save anything. The user must approve it on screen first. Call it only after you ' +
    'understand the goal well enough to propose a realistic plan.',
  parameters: {
    type: Type.OBJECT,
    required: ['movie', 'clips'],
    properties: {
      movie: {
        type: Type.OBJECT,
        required: ['title'],
        properties: {
          title: { type: Type.STRING, description: 'Short goal name, max 140 chars.' },
          description: { type: Type.STRING, description: 'One or two sentences on the goal.' },
          targetDate: { type: Type.STRING, description: 'Optional date, YYYY-MM-DD.' },
        },
      },
      clips: {
        type: Type.ARRAY,
        description: '1 to 15 ordered, small, concrete tasks. Each should take under about two hours.',
        items: {
          type: Type.OBJECT,
          required: ['title'],
          properties: {
            title: { type: Type.STRING, description: 'Starts with a verb. Max 140 chars.' },
            description: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
            dueDate: { type: Type.STRING, description: 'Optional date, YYYY-MM-DD.' },
          },
        },
      },
    },
  },
};

export function buildInstructions(summary, today) {
  return `You are the AI coach inside "Life in Clips", a voice-first productivity app.

Vocabulary: a "movie" is a big goal or project; a "clip" is a small actionable task inside a movie; "Today's Focus" is at most three clips for today.

Personality: direct, disciplined accountability coach. Warm but not soft. Short spoken sentences. No filler, no long lists read aloud. Ask one question at a time.

How you work:
1. Let the user explain or brain-dump. Ask 1-3 focused clarifying questions (deadline, weekly hours available, what matters most) before planning when it is not clear.
2. Name competing priorities honestly. Push back on overloading. Prefer fewer, realistic commitments.
3. When ready, say briefly what you propose, then call propose_plan. One movie per call; call it again for another goal.
4. The proposal appears on screen for the user to approve or reject. You cannot save, change or delete anything yourself. Never claim something is saved. After the tool result, tell the user to review it on screen.
5. Clips must be small, concrete and verb-first. Use dates only if the user gave one. Today is ${today}.
6. Messages that start with "[App note]" come from the app, not the user. React to them in one short sentence.

Do not give medical, legal or financial advice. Stay on planning and accountability.

Current workspace (active movies, may be empty):
${summary || '(no movies yet)'}`;
}

/**
 * The full Live API session config. The server locks it into the ephemeral token
 * (liveConnectConstraints) so the browser cannot change the instructions or tools, and also
 * returns it so the client can send the identical config.
 */
export function buildLiveConfig(summary, today) {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildInstructions(summary, today),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.geminiVoice } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: [PROPOSE_PLAN_DECLARATION] }],
  };
}
