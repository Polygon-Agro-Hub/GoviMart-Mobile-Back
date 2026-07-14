const Joi = require("joi");

// Login Schema
const loginSchema = Joi.object({
  identifier: Joi.string().trim().required().messages({
    "string.empty": "Mobile number or email is required",
    "any.required": "Mobile number or email is required",
  }),
  password: Joi.string().trim().required().messages({
    "string.empty": "Password is required",
    "any.required": "Password is required",
  }),
});

module.exports = {
  loginSchema,
};
