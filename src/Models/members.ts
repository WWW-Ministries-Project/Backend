import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema(
  {
    title: {
      type: String,
    },
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
    phone_number_1: {
      type: String,
    },
    phone_number_2: {
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
    visits: {
      type: Number,
    },
    photo: {
      type: String,
    },
    status: {
      type: Boolean,
      default: true,
    },
    department: {
      type: String,
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
