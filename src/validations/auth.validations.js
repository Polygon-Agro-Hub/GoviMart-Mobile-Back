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
  firstName: Joi.string().trim().pattern(/^\S+$/).required().messages({
    "string.pattern.base": "First name cannot contain spaces",
  }),
  lastName: Joi.string().trim().pattern(/^\S+$/).required().messages({
    "string.pattern.base": "Last name cannot contain spaces",
  }),
  phoneCode: Joi.string().trim().required(),
  phoneNumber: Joi.string().trim().pattern(/^\S+$/).required().messages({
    "string.pattern.base": "Mobile number cannot contain spaces",
  }),
  buyerType: Joi.string().valid("Retail", "Wholesale").required(),
  email: Joi.string().email().trim().pattern(/^\S+$/).required().messages({
    "string.pattern.base": "Email cannot contain spaces",
  }),
  nic: Joi.string().trim().pattern(/^(?:\d{9}[vVxX]|\d{12})$/).required().messages({
    "string.empty": "NIC number is required",
    "string.pattern.base": "Invalid NIC number format",
    "any.required": "NIC number is required",
  }),
  password: Joi.string().pattern(/^\S+$/).required().messages({
    "string.pattern.base": "Password cannot contain spaces",
  }),
  agreeToMarketing: Joi.boolean().optional(),
  agreeToTerms: Joi.boolean().required(),
  confirmPassword: Joi.string().pattern(/^\S+$/).required().valid(Joi.ref("password")).messages({
    "string.pattern.base": "Confirm password cannot contain spaces",
  }),
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
  allowRestore: Joi.boolean().optional(),
});

module.exports = {
  loginSchema,
  signupSchema,
};
