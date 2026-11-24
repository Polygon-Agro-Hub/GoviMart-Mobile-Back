const Joi = require("joi");

const phoneNumberSchema = Joi.alternatives()
  .try(
    Joi.string().pattern(/^\+?\d+$/).min(9).max(15),
    Joi.number()
      .integer()
      .min(100000000)
      .max(999999999999999)
      .custom((value) => String(value))
  )
  .messages({
    "string.pattern.base": "Phone number must be numeric",
    "string.min": "Phone number must be at least 9 digits",
    "string.max": "Phone number cannot exceed 15 digits",
  });

const addAddressSchema = Joi.object({
  buildingType: Joi.string().valid("House", "Apartment").required().messages({
    "any.only": "Invalid building type. Must be either 'House' or 'Apartment'",
    "any.required": "Building type is required",
  }),
  saveAs: Joi.string().trim().max(30).required().messages({
    "string.empty": "Save address name is required",
    "any.required": "Save address name is required",
  }),
  title: Joi.string().trim().optional().allow("", null),
  billingTitle: Joi.string().trim().optional().allow("", null),
  fullName: Joi.string().trim().optional().allow("", null),
  billingName: Joi.string().trim().optional().allow("", null),
  phonecode1: Joi.string().trim().optional().allow("", null),
  billingPhoneCode1: Joi.string().trim().optional().allow("", null),
  phone1: phoneNumberSchema.required().messages({
    "any.required": "Phone number 1 is required",
  }),
  billingPhone1: phoneNumberSchema.optional().allow("", null),
  phonecode2: Joi.string().trim().optional().allow("", null),
  billingPhoneCode2: Joi.string().trim().optional().allow("", null),
  phone2: phoneNumberSchema.optional().allow("", null),
  billingPhone2: phoneNumberSchema.optional().allow("", null),
  latitude: Joi.number().optional().allow(null),
  longitude: Joi.number().optional().allow(null),
  buildingNo: Joi.string().trim().optional().allow("", null),
  houseNo: Joi.string().trim().optional().allow("", null),
  buildingName: Joi.string().trim().optional().allow("", null),
  unitNo: Joi.string().trim().optional().allow("", null),
  floorNo: Joi.string().trim().optional().allow("", null),
  streetName: Joi.string().trim().optional().allow("", null),
  city: Joi.string().trim().optional().allow("", null),
  nearestCity: Joi.string().trim().optional().allow("", null),
});

const updateAddressSchema = Joi.object({
  buildingType: Joi.string().valid("House", "Apartment").optional().allow("", null),
  saveAs: Joi.string().trim().max(30).required().messages({
    "string.empty": "Save address name is required",
    "any.required": "Save address name is required",
  }),
  title: Joi.string().trim().optional().allow("", null),
  billingTitle: Joi.string().trim().optional().allow("", null),
  fullName: Joi.string().trim().optional().allow("", null),
  billingName: Joi.string().trim().optional().allow("", null),
  phonecode1: Joi.string().trim().optional().allow("", null),
  billingPhoneCode1: Joi.string().trim().optional().allow("", null),
  phone1: phoneNumberSchema.required().messages({
    "any.required": "Phone number 1 is required",
  }),
  billingPhone1: phoneNumberSchema.optional().allow("", null),
  phonecode2: Joi.string().trim().optional().allow("", null),
  billingPhoneCode2: Joi.string().trim().optional().allow("", null),
  phone2: phoneNumberSchema.optional().allow("", null),
  billingPhone2: phoneNumberSchema.optional().allow("", null),
  latitude: Joi.number().optional().allow(null),
  longitude: Joi.number().optional().allow(null),
  buildingNo: Joi.string().trim().optional().allow("", null),
  houseNo: Joi.string().trim().optional().allow("", null),
  buildingName: Joi.string().trim().optional().allow("", null),
  unitNo: Joi.string().trim().optional().allow("", null),
  floorNo: Joi.string().trim().optional().allow("", null),
  streetName: Joi.string().trim().optional().allow("", null),
  city: Joi.string().trim().optional().allow("", null),
  nearestCity: Joi.string().trim().optional().allow("", null),
});

module.exports = {
  addAddressSchema,
  updateAddressSchema,
};
