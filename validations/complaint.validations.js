const Joi = require("joi");

// Create Complain Schema
const createComplainSchema = Joi.object({
  complaicategoryId: Joi.number().required().messages({
    "number.base": "Complaint category is required",
    "any.required": "Complaint category is required",
  }),
  complain: Joi.string().trim().min(5).required().messages({
    "string.empty": "Description is required",
    "string.min": "Description is too short",
    "any.required": "Description is required",
  }),
});

module.exports = {
  createComplainSchema,
};