const Joi = require("joi");

// Create Complain Schema
const createComplainSchema = Joi.object({
  complaicategoryId: Joi.alternatives().try(Joi.number(), Joi.string()).required().messages({
    "number.base": "Complaint category is required",
    "any.required": "Complaint category is required",
  }),
  complain: Joi.string().trim().min(3).required().messages({
    "string.empty": "Description is required",
    "string.min": "Description is too short (minimum 3 characters)",
    "any.required": "Description is required",
  }),
}).unknown(true);

module.exports = {
  createComplainSchema,
};