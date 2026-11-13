import mongoose from 'mongoose';
import { MOVIE_STATUSES } from '../lib/schemas.js';

/**
 * Relationship design: clips reference their movie (Clip.movieId) and carry an `order`.
 * The movie does NOT store clip ids or a progress number, so there is nothing to drift.
 * Progress is always computed from the actual clips.
 */
const movieSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: MOVIE_STATUSES, default: 'active' },
    targetDate: { type: Date, default: null },
  },
  { timestamps: true },
);

movieSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    ret.targetDate = ret.targetDate ? ret.targetDate.toISOString().slice(0, 10) : null;
    return ret;
  },
});

export const Movie = mongoose.model('Movie', movieSchema);
