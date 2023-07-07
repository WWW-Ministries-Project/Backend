import mongoose from "mongoose";

const AttendanceSchema = new mongoose.Schema(
  {
    member_id: { type: mongoose.Schema.Types.ObjectId, ref: "MemberModel" },
    date: {
      type: Date,
      required: true,
    },
  },
  {
    collection: "attendance",
  }
);

export const AttendanceModel = mongoose.model(
  "AttendanceSchema",
  AttendanceSchema
);
