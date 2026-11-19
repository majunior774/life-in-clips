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


const str = (description) => ({ type: Type.STRING, description });
const PRIORITY = { type: Type.STRING, enum: ['low', 'medium', 'high'] };
const DATE = 'YYYY-MM-DD. Empty string clears the date.';

/**
 * Tools that act on existing data. They run in the browser through the normal, validated REST
 * API, only when the user asked for the action. Every action appears in the on-screen activity
 * log with Undo where possible; deletes need an on-screen confirmation click.
 */
export const ACTION_DECLARATIONS = [
  {
    name: 'get_workspace',
    description:
      'Read the current movies, their clips (with ids, status, priority, due date) and today\'s focus clip ids. Call this before any action that needs an id, and whenever you are unsure what exists. Never guess ids.',
  },
  {
    name: 'update_clip',
    description:
      'Edit one existing clip, including marking it done (status "completed"), in progress or back to "todo". Only when the user asked for that change.',
    parameters: {
      type: Type.OBJECT,
      required: ['clipId'],
      properties: {
        clipId: str('Id from get_workspace.'),
        title: str('New title, max 140 chars.'),
        description: str('New notes.'),
        status: { type: Type.STRING, enum: ['todo', 'in_progress', 'completed'] },
        priority: PRIORITY,
        dueDate: str(DATE),
      },
    },
  },
  {
    name: 'update_movie',
    description: 'Edit one existing movie: title, description, target date, or status (active, completed, archived). Only when the user asked.',
    parameters: {
      type: Type.OBJECT,
      required: ['movieId'],
      properties: {
        movieId: str('Id from get_workspace.'),
        title: str('New title, max 140 chars.'),
        description: str('New description.'),
        status: { type: Type.STRING, enum: ['active', 'completed', 'archived'] },
        targetDate: str(DATE),
      },
    },
  },
  {
    name: 'add_clips',
    description: 'Add 1 to 10 new clips to an EXISTING movie. (For a brand-new goal use propose_plan.) Only when the user asked.',
    parameters: {
      type: Type.OBJECT,
      required: ['movieId', 'clips'],
      properties: {
        movieId: str('Id from get_workspace.'),
        clips: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ['title'],
            properties: { title: str('Verb-first, max 140 chars.'), description: str('Optional notes.'), priority: PRIORITY, dueDate: str('YYYY-MM-DD') },
          },
        },
      },
    },
  },
  {
    name: 'set_todays_focus',
    description: 'Replace Today\'s Focus with up to 3 existing clips (an empty list clears it). Only when the user asked.',
    parameters: {
      type: Type.OBJECT,
      required: ['clipIds'],
      properties: { clipIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'At most 3 clip ids.' } },
    },
  },
  {
    name: 'approve_pending_plan',
    description:
      'Approve and save a plan that is waiting on screen. Only when the user clearly tells you to approve or save it. If several plans wait, pass the title of the one they mean.',
    parameters: { type: Type.OBJECT, properties: { title: str('Movie title of the plan, if several are waiting.') } },
  },
  {
    name: 'reject_pending_plan',
    description: 'Discard a plan that is waiting on screen. Only when the user clearly says to reject or drop it.',
    parameters: { type: Type.OBJECT, properties: { title: str('Movie title of the plan, if several are waiting.') } },
  },
  {
    name: 'request_delete',
    description:
      'Ask to delete one clip or one whole movie (with all its clips). This does NOT delete anything: it shows a confirmation on screen and the user must click it themselves.',
    parameters: {
      type: Type.OBJECT,
      required: ['kind', 'id'],
      properties: { kind: { type: Type.STRING, enum: ['clip', 'movie'] }, id: str('Id from get_workspace.') },
    },
  },
];

export function buildInstructions(summary, today) {
  return `You are the AI coach inside "Life in Clips", a voice-first productivity app.

Vocabulary: a "movie" is a big goal or project; a "clip" is a small actionable task inside a movie; "Today's Focus" is at most three clips for today.

Personality: direct, disciplined accountability coach. Warm but not soft. Short spoken sentences. No filler, no long lists read aloud. Ask one question at a time.

How you work:
1. Let the user explain or brain-dump. Ask 1-3 focused clarifying questions (deadline, weekly hours available, what matters most) before planning when it is not clear.
2. Name competing priorities honestly. Push back on overloading. Prefer fewer, realistic commitments.
3. When ready, say briefly what you propose, then call propose_plan. One movie per call; call it again for another goal.
4. New goals: the proposal appears on screen for the user to approve or reject. You cannot save a new plan yourself; only approve_pending_plan, after the user tells you to, or their own click, saves it. Never claim something is saved before a tool result says so.
5. Clips must be small, concrete and verb-first. Use dates only if the user gave one. Today is ${today}.
6. Messages that start with "[App note]" come from the app, not the user. React to them in one short sentence.
7. Acting on existing data: you can edit movies and clips, tick clips done, add clips, set Today's Focus and approve or reject plans, but ONLY when the user's latest request clearly asks for it. Never act on your own initiative, never mark a clip done unless the user says they did it, and ask when it is ambiguous which item they mean. Call get_workspace first to get real ids; never invent ids.
8. After every action tool, say in one short sentence what happened, using the tool result. If the result says ok:false, tell the user plainly that it did not work and why. Deleting only ever happens when the user clicks the confirmation on screen; say so.

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
    tools: [{ functionDeclarations: [PROPOSE_PLAN_DECLARATION, ...ACTION_DECLARATIONS] }],
  };
}
