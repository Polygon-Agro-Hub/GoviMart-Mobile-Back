const fetch = globalThis.fetch || require("node-fetch");

/**
 * Normalizes phone number into international format without '+' for ShoutOUT (e.g., 94771234567).
 * Handles Sri Lankan numbers (07XXXXXXXX, 7XXXXXXXX, +947XXXXXXXX, 947XXXXXXXX).
 *
 * @param {string|number} phone
 * @param {string} [phoneCode="94"]
 * @returns {string|null}
 */
const formatPhoneNumber = (phone, phoneCode = "94") => {
  if (!phone) return null;
  const rawDigits = String(phone).trim().replace(/[^0-9]/g, "");
  if (!rawDigits) return null;

  const codeDigits = String(phoneCode || "94").replace(/[^0-9]/g, "") || "94";

  // If already starts with the country code followed by 0 (e.g. 940771234567)
  if (rawDigits.startsWith(`${codeDigits}0`)) {
    return `+${codeDigits}${rawDigits.slice(codeDigits.length).replace(/^0+/, "")}`;
  }

  // If already starts with the country code (e.g. 94771234567)
  if (rawDigits.startsWith(codeDigits)) {
    return `+${rawDigits}`;
  }

  // Strip leading zero(s) (e.g. 0771234567 -> 771234567)
  const noZero = rawDigits.replace(/^0+/, "");
  return `+${codeDigits}${noZero}`;
};

/**
 * Dispatches an SMS via the ShoutOUT SMS Gateway.
 * This is non-blocking: any failure or network glitch is logged and returned
 * safely without throwing, so business transactions are never broken.
 *
 * @param {string} destinationPhone
 * @param {string} message
 * @returns {Promise<{success: boolean, referenceId?: string, error?: string}>}
 */
const sendSms = async (destinationPhone, message) => {
  try {
    const formattedPhone = formatPhoneNumber(destinationPhone);
    if (!formattedPhone) {
      console.warn("⚠️ [SMS Service] Cannot send SMS: destination phone is invalid or empty.", destinationPhone);
      return { success: false, error: "Invalid phone number" };
    }

    const apiKey = process.env.SHOUTOUT_API_KEY;
    if (!apiKey) {
      console.warn("⚠️ [SMS Service] SHOUTOUT_API_KEY is missing from environment. Skipping SMS.");
      return { success: false, error: "Missing SHOUTOUT_API_KEY" };
    }

    const apiUrl = "https://api.getshoutout.com/coreservice/messages";
    const headers = {
      Authorization: `Apikey ${apiKey}`,
      "Content-Type": "application/json",
    };
    const body = {
      source: "Polygon",
      transports: ["sms"],
      content: { sms: message },
      destinations: [formattedPhone],
    };

    console.log(`[SMS Service] Sending ShoutOUT SMS to ${formattedPhone}: "${message}"`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const refId =
      data.referenceId ||
      data.reference_id ||
      (Array.isArray(data.responses) && (data.responses[0]?.reference_id || data.responses[0]?.referenceId));

    const isSuccess =
      response.ok &&
      (refId || data.status === "1001" || data.status === 1001 || data.description === "submit success");

    if (!isSuccess) {
      const errMsg =
        data.message ||
        data.error ||
        data.description ||
        `HTTP status ${response.status}`;
      console.error(`❌ [SMS Service] Failed to send SMS via ShoutOUT: ${errMsg}`);
      return { success: false, error: errMsg };
    }

    const referenceId = refId || "SUCCESS";
    console.log(`[SMS Service] SMS successfully sent to ${formattedPhone}. Ref: ${referenceId}`);
    return { success: true, referenceId };
  } catch (error) {
    console.error("❌ [SMS Service] Exception sending SMS via ShoutOUT:", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  formatPhoneNumber,
  sendSms,
};
