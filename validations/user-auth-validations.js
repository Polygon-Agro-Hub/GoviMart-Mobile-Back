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

// Signup Schema
const signupSchema = Joi.object({
  title: Joi.string().trim().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
  phoneCode: Joi.string().trim().required(),
  phoneNumber: Joi.string().trim().required(),
  buyerType: Joi.string().valid("Retail", "Wholesale").required(),
  email: Joi.string().email().trim().required(),
  password: Joi.string().required(),
  agreeToMarketing: Joi.boolean().optional(),
  agreeToTerms: Joi.boolean().required(),
  confirmPassword: Joi.string().required().valid(Joi.ref("password")),
  city: Joi.string().allow("", null).optional(),
  cityId: Joi.number().allow(null).optional(),
  companyName: Joi.when("buyerType", {
    is: "Wholesale",
    then: Joi.string().trim().required(),
    otherwise: Joi.string().allow("", null).optional(),
  }),
  companyPhoneCode: Joi.when("buyerType", {
    is: "Wholesale",
    then: Joi.string().trim().required(),
    otherwise: Joi.string().allow("", null).optional(),
  }),
  companyPhoneNumber: Joi.when("buyerType", {
    is: "Wholesale",
    then: Joi.string().trim().required(),
    otherwise: Joi.string().allow("", null).optional(),
  }),
});

module.exports = {
  loginSchema,
  signupSchema,
};
