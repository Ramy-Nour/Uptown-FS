import Joi from 'joi'

/**
 * Generic validation middleware.
 * - part: 'body' | 'query' | 'params'
 * - Uses abortEarly=false, stripUnknown=true for robust error reporting and safe payloads.
 */
export function validate(schema, part = 'body') {
  return (req, res, next) => {
    const target = part === 'query' ? req.query : part === 'params' ? req.params : req.body
    const { error, value } = schema.validate(target, { abortEarly: false, stripUnknown: true, convert: true })
    if (error) {
      return res.status(400).json({
        error: {
          message: 'Validation failed',
          details: error.details.map(d => ({ message: d.message, path: d.path })),
          type: 'validation_error'
        }
      })
    }
    if (part === 'query') req.query = value
    else if (part === 'params') req.params = value
    else req.body = value
    next()
  }
}

/**
 * Schemas by feature
 */

// Auth
export const authRegisterSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().optional()
})

export const authLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).required()
})

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().min(10).required()
})

export const requestResetSchema = Joi.object({
  email: Joi.string().email().required()
})

export const resetPasswordSchema = Joi.object({
  token: Joi.string().min(10).required(),
  newPassword: Joi.string().min(6).required()
})

export const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().optional(),
  notes: Joi.string().allow('').optional(),
  meta: Joi.object().unknown(true).optional()
})

export const setRoleSchema = Joi.object({
  role: Joi.string().required()
})

export const setActiveSchema = Joi.object({
  active: Joi.boolean().required()
})

export const updateUserSchema = Joi.object({
  email: Joi.string().email().optional(),
  notes: Joi.string().allow('').optional(),
  meta: Joi.object().unknown(true).optional()
}).min(1)

export const setPasswordAdminSchema = Joi.object({
  newPassword: Joi.string().min(6).required()
})

export const usersByRoleQuerySchema = Joi.object({
  role: Joi.string().required()
})

// Customers (match field names used in routes)
export const customerCreateSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().min(5).max(20).required(),
  nationality: Joi.string().allow('').optional(),
  id_number: Joi.string().allow('').optional(),
  id_type: Joi.string().allow('').optional(),
  address: Joi.string().allow('').optional(),
  date_of_birth: Joi.string().allow('').optional(),
  occupation: Joi.string().allow('').optional(),
  company: Joi.string().allow('').optional()
})

export const customerUpdateSchema = Joi.object({
  name: Joi.string().min(2).max(255).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().min(5).max(20).optional(),
  nationality: Joi.string().allow('').optional(),
  id_number: Joi.string().allow('').optional(),
  id_type: Joi.string().allow('').optional(),
  address: Joi.string().allow('').optional(),
  date_of_birth: Joi.string().allow('').optional(),
  occupation: Joi.string().allow('').optional(),
  company: Joi.string().allow('').optional()
}).min(1)

export const customerSearchQuerySchema = Joi.object({
  q: Joi.string().min(2).required()
})

// Offers workflow
export const offerStatusSchema = Joi.object({
  status: Joi.string().min(2).required(),
  reason: Joi.string().allow('').optional()
})

export const bulkOfferActionSchema = Joi.object({
  offerIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
  action: Joi.string().min(2).required(),
  reason: Joi.string().allow('').optional()
})

// Blocks
export const blockRequestSchema = Joi.object({
  unitId: Joi.number().integer().positive().required(),
  durationDays: Joi.number().integer().min(1).max(7).required(),
  reason: Joi.string().allow('').optional()
})

export const blockApproveSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject').required(),
  reason: Joi.string().allow('').optional()
})

export const blockExtendSchema = Joi.object({
  additionalDays: Joi.number().integer().positive().required(),
  reason: Joi.string().allow('').optional()
})

// Deals
export const dealCreateSchema = Joi.object({
  title: Joi.string().min(1).required(),
  amount: Joi.number().min(0).required(),
  details: Joi.object().unknown(true).optional(),
  unitType: Joi.string().allow('').optional(),
  salesRepId: Joi.number().integer().positive().allow(null).optional(),
  policyId: Joi.number().integer().positive().allow(null).optional()
})

export const dealUpdateSchema = Joi.object({
  title: Joi.string().min(1).optional(),
  amount: Joi.number().min(0).optional(),
  details: Joi.object().unknown(true).optional(),
  unitType: Joi.string().allow('').optional(),
  salesRepId: Joi.number().integer().positive().allow(null).optional(),
  policyId: Joi.number().integer().positive().allow(null).optional()
}).min(1)

export const dealSubmitSchema = Joi.object({
  acceptability: Joi.object({
    acceptable_pv: Joi.boolean().optional(),
    acceptable_first_year: Joi.boolean().optional(),
    acceptable_second_year: Joi.boolean().optional(),
    acceptable_handover: Joi.boolean().optional()
  }).optional()
})

export const dealRejectSchema = Joi.object({
  reason: Joi.string().allow('').optional()
})

export const overrideRequestSchema = Joi.object({
  reason: Joi.string().allow('').optional()
})

export const overrideApproveSchema = Joi.object({
  notes: Joi.string().allow('').optional()
})

export const editRequestSchema = Joi.object({
  reason: Joi.string().allow('').optional(),
  fields: Joi.array().items(Joi.string().min(1)).optional(),
  comment: Joi.string().allow('').optional()
})

export const editsAddressedSchema = Joi.object({
  notes: Joi.string().allow('').optional()
})

// Documents
export const generateDocumentSchema = Joi.object({
  templateName: Joi.string().min(1).optional(),
  documentType: Joi.string().min(1).optional(),
  deal_id: Joi.number().integer().positive().optional(),
  data: Joi.object().unknown(true).required(),
  language: Joi.string().optional(),
  currency: Joi.string().optional()
}).xor('templateName', 'documentType') // require one of them

// Calculation endpoints (minimal envelope validation; detailed checks remain in app)
export const calculateSchema = Joi.object({
  mode: Joi.string().min(2).required(),
  stdPlan: Joi.object().unknown(true).optional(),
  inputs: Joi.object().unknown(true).optional(),
  standardPricingId: Joi.number().integer().positive().optional(),
  unitId: Joi.number().integer().positive().optional()
}).with('stdPlan', ['mode'])

export const generatePlanSchema = Joi.object({
  mode: Joi.string().min(2).required(),
  stdPlan: Joi.object().unknown(true).optional(),
  inputs: Joi.object().unknown(true).optional(),
  language: Joi.string().optional(),
  currency: Joi.string().optional(),
  languageForWrittenAmounts: Joi.string().optional(),
  standardPricingId: Joi.number().integer().positive().optional(),
  unitId: Joi.number().integer().positive().optional()
})