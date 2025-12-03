import express from 'express'
import standardPricingRoutes from './standardPricingRoutes.js'
import paymentPlansRoutes from './paymentPlansRoutes.js'
import reservationFormsRoutes from './reservationFormsRoutes.js'
import teamsRoutes from './teamsRoutes.js'

const router = express.Router()

// Preserve original /api/workflow surface by mounting
// domain-specific subrouters at the root. All paths
// (e.g. /standard-pricing, /payment-plans/..., /reservation-forms/...,
// /sales-teams/...) remain unchanged.
router.use('/', standardPricingRoutes)
router.use('/', paymentPlansRoutes)
router.use('/', reservationFormsRoutes)
router.use('/', teamsRoutes)

export default router