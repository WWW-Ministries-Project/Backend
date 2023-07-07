import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: true,
    },
    last_name: {
      type: String,
      required: true,
    },
    date_of_birth: {
      type: Date,
      required: true,
    },
    gender: {
      type: String,
      required: true,
    },
    phone_number: {
      type: String,
    },
    email: {
      type: String,
    },
    address: {
      type: String,
    },
    country: {
      type: String,
    },
    occupation: {
      type: String,
    },
    company: {
      type: String,
    },
    member_since: {
      type: Date,
    },
    photo: {
      type: String,
    },
    status: {
      type: Boolean,
      default: true,
    },
    partner: {
      type: Boolean,
      default: false,
    },
  },
  {
    collection: "members",
  }
);

export const MemberModel = mongoose.model("MemberSchema", MemberSchema);
