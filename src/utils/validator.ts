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
  description: Joi.string(),
});
export const departmentSchema = Joi.object({
  name: Joi.string()
      .trim()
      .pattern(/^[A-Za-z0-9\s]+$/) // only alphabets + spaces
      .min(2)
      .max(100)
      .required()
      .messages({
        "string.empty": "Department name is required",
        "string.pattern.base": "Department name must contain only alphabets",
        "string.min": "Department name must be at least 2 characters",
        "string.max": "Department name must not exceed 100 characters",
      }),

  description: Joi.string()
      .trim()
      .pattern(/^[A-Za-z0-9\s]+$/) // only alphabets + spaces
      .max(250)
      .required()
      .messages({
        "string.empty": "Description is required",
        "string.pattern.base": "Description must contain only alphabets",
        "string.max": "Description must not exceed 250 characters",
      }),
});

export const validateSignup = validator(signupSchema);

