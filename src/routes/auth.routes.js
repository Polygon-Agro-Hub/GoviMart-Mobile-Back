const express = require('express');
const router = express.Router();
const userAuthEp = require('../endpoint/auth.ep');
const loginRateLimiter = require('../middlewares/rateLimiter.middleware');
const authMiddleware = require('../middlewares/auth.middleware');

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

/**
 * @openapi
 * /api/auth/cities:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Retrieve or search cities
 *     description: Retrieve all cities sorted alphabetically or search for cities matching an optional query parameter 'q'.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: false
 *         description: Optional query term to search cities by name.
 *     responses:
 *       200:
 *         description: Successfully retrieved list of cities.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       city:
 *                         type: string
 *                         example: "Colombo"
 *                       district:
 *                         type: string
 *                         example: "Colombo"
 *                       province:
 *                         type: string
 *                         example: "Western"
 *                       isAvailable:
 *                         type: boolean
 *                         example: true
 *       500:
 *         description: Failed to retrieve cities.
 */
router.get('/cities', userAuthEp.getCities);
router.post('/city-availability', userAuthEp.updateCityAvailability);

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new Marketplace User
 *     description: Create a new marketplace user profile for either Home (Retail) or Business (Wholesale) purchasing.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - firstName
 *               - lastName
 *               - phoneCode
 *               - phoneNumber
 *               - buyerType
 *               - email
 *               - password
 *               - confirmPassword
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Mr"
 *               firstName:
 *                 type: string
 *                 example: "Daham"
 *               lastName:
 *                 type: string
 *                 example: "Silva"
 *               phoneCode:
 *                 type: string
 *                 example: "+94"
 *               phoneNumber:
 *                 type: string
 *                 example: "770111999"
 *               buyerType:
 *                 type: string
 *                 enum: [Retail, Wholesale]
 *                 example: "Retail"
 *               email:
 *                 type: string
 *                 example: "daham@gmail.com"
 *               password:
 *                 type: string
 *                 example: "Password123!"
 *               confirmPassword:
 *                 type: string
 *                 example: "Password123!"
 *               agreeToMarketing:
 *                 type: boolean
 *                 example: true
 *               agreeToTerms:
 *                 type: boolean
 *                 example: true
 *               companyName:
 *                 type: string
 *                 example: "Daham Holdings"
 *               companyPhoneCode:
 *                 type: string
 *                 example: "+94"
 *               companyPhoneNumber:
 *                 type: string
 *                 example: "112345678"
 *               city:
 *                 type: string
 *                 example: "Colombo"
 *     responses:
 *       201:
 *         description: User registered successfully.
 *       400:
 *         description: Validation error or Email already in use.
 *       500:
 *         description: Database insertion issue or unexpected error.
 */
router.post('/signup', userAuthEp.userSignup);

/**
 * @openapi
 * /api/auth/verify-signup:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Verify OTP and complete sign up
 *     description: Validate the sent 5-digit verification code and save the user to the database.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - referenceId
 *               - signupToken
 *             properties:
 *               code:
 *                 type: string
 *                 example: "12345"
 *               referenceId:
 *                 type: string
 *                 example: "a8f30c12-32b4-4062-85a2-c11c12d45ef7"
 *               signupToken:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       201:
 *         description: User registered successfully.
 *       400:
 *         description: Verification failed or expired.
 *       500:
 *         description: Database or internal server error.
 */
router.post('/verify-signup', userAuthEp.verifySignup);

/**
 * @openapi
 * /api/auth/resend-signup-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Resend verification code
 *     description: Decodes the signupToken to retrieve user signup information, sends a new OTP, and returns a new referenceId and signupToken.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signupToken
 *             properties:
 *               signupToken:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Verification code resent successfully.
 *       400:
 *         description: Token invalid or expired.
 *       500:
 *         description: Internal server error.
 */
router.post('/resend-signup-otp', userAuthEp.resendSignupOtp);

/**
 * @openapi
 * /api/auth/update-password:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Update User Password
 *     description: Update the dashboard user's password and flag it as updated.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *               - confirmNewPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *               confirmNewPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated successfully.
 *       400:
 *         description: Validation or match error.
 *       401:
 *         description: Unauthorized.
 */
router.post('/update-password', authMiddleware, userAuthEp.updatePassword);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout Marketplace User
 *     description: Clear the session cookie and invalidate user session.
 *     responses:
 *       200:
 *         description: Logout successful.
 */
router.post('/logout', userAuthEp.logout);

/**
 * @openapi
 * /api/auth/refresh-token:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Refresh Access Token
 *     description: Generate a new access token using a valid refresh token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully.
 *       400:
 *         description: Refresh token missing.
 *       401:
 *         description: Invalid or expired refresh token.
 */
router.post('/refresh-token', userAuthEp.refreshToken);

// Update / Clear Credit Balance (matches Web API /api/auth/update-credit-balance)
const customerEp = require('../endpoint/customer.ep');
router.put('/update-credit-balance', authMiddleware, customerEp.updateCreditBalance);

module.exports = router;
