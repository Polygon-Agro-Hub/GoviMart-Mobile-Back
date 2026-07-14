const express = require('express');
const router = express.Router();
const userAuthEp = require('../endpoint/user-auth-ep');
const loginRateLimiter = require('../middlewares/rateLimiter.middleware');

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login Marketplace User
 *     description: Authenticate a marketplace user using email/mobile number and password.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 example: "771234567"
 *               password:
 *                 type: string
 *                 example: "Password123"
 *     responses:
 *       200:
 *         description: Successfully logged in.
 *       400:
 *         description: Bad Request / Validation error.
 *       401:
 *         description: Unauthorized / Invalid credentials.
 */
router.post('/login', loginRateLimiter, userAuthEp.login);

module.exports = router;
