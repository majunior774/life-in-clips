import mongoose from 'mongoose';

/**
 * Today's Focus: one document per calendar date ("YYYY-MM-DD", supplied by the client so it
 * matches the user's local day). Holds up to 3 clip ids. Clips deleted later are pruned.
 */
const focusSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    clipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Clip' }],
  },
  { timestamps: true },
);

export const Focus = mongoose.model('Focus', focusSchema);
