import Joi from "joi";

const validator = (schema: any) => (payload: any) => {
  schema.validate(payload, { abortEarly: false });
};

const signupSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(3).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(3).required(),
});
export const assetSchema = Joi.object({
  name: Joi.string().required(),
  asset_code: Joi.string().required(),
  status: Joi.string().required(),
  date_purchased: Joi.date(),
  date_assigned: Joi.date(),
  price: Joi.number(),
  description: Joi.string()
})

export const validateSignup = validator(signupSchema);