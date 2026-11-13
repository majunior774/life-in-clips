import mongoose from 'mongoose';
import { CLIP_STATUSES, PRIORITIES } from '../lib/schemas.js';

const clipSchema = new mongoose.Schema(
  {
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: CLIP_STATUSES, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    dueDate: { type: Date, default: null },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

clipSchema.index({ movieId: 1, order: 1 });

clipSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    ret.movieId = String(ret.movieId);
    ret.dueDate = ret.dueDate ? ret.dueDate.toISOString().slice(0, 10) : null;
    return ret;
  },
});

export const Clip = mongoose.model('Clip', clipSchema);
