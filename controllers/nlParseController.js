const FacilityPreferences = require("../models/facilityPreferencesModel");
const { hasPermission } = require("../config/authorization");
const {
  FORM_PARSERS,
  getFormParserConfig,
  isFormParserImplemented,
  getTodayInfo,
} = require("../config/nlFormParsers");
const {
  callAnthropicTool,
  AnthropicParseError,
} = require("../utils/anthropicClient");

// POST /api/v1/nl/parse
// Never writes to the database — returns a draft the client submits through
// the real form endpoint (POST /coverage, POST /schedules, etc.).
exports.parseForm = async (req, res, next) => {
  try {
    const { formType, message } = req.body || {};

    if (!formType || typeof formType !== "string") {
      return res.status(400).json({
        code: "missing_form_type",
        message: "formType is required",
      });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        code: "missing_message",
        message: "message is required",
      });
    }

    const config = getFormParserConfig(formType);
    if (!config) {
      return res.status(400).json({
        code: "unknown_form_type",
        message: `Unknown formType '${formType}'`,
        supportedFormTypes: Object.keys(FORM_PARSERS),
      });
    }

    if (!hasPermission(req.user, config.permission)) {
      return res.status(403).json({
        code: "forbidden",
        message: `You don't have permission to use AI parsing for '${formType}'.`,
        requiredPermission: config.permission,
      });
    }

    if (!isFormParserImplemented(config)) {
      return res.status(501).json({
        code: "form_type_not_implemented",
        message: `AI parsing for '${formType}' isn't available yet.`,
      });
    }

    let facilityPrefs = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    if (!facilityPrefs) facilityPrefs = {};

    const context = config.buildContext(facilityPrefs);

    if (typeof config.describeConfigGaps === "function") {
      const configGaps = config.describeConfigGaps(context);
      if (configGaps.length) {
        return res.status(422).json({
          code: "facility_not_configured",
          message:
            "This facility is missing setup needed before AI parsing can run.",
          gaps: configGaps,
        });
      }
    }

    const todayInfo = getTodayInfo(context.facilityTimezone);
    const tool = config.buildTool(context);
    const systemPrompt = config.buildSystemPrompt(context, todayInfo);

    const userMessage = JSON.stringify({
      message,
      currentFormState: req.body.currentFormState || {},
    });

    let draft;
    try {
      draft = await callAnthropicTool({ systemPrompt, userMessage, tool });
    } catch (err) {
      if (err instanceof AnthropicParseError) {
        return res.status(502).json({ code: err.code, message: err.message });
      }
      throw err;
    }

    if (typeof config.normalizeDraft === "function") {
      draft = config.normalizeDraft(draft, context);
    }

    const { valid, errors } = config.validateDraft(draft, context);
    if (!valid) {
      return res.status(502).json({
        code: "invalid_draft",
        message:
          "The AI's response didn't match what this form expects. See errors for what to fix or rephrase.",
        errors,
      });
    }

    res.json({
      formType,
      draft,
      meta: {
        generatedAt: new Date().toISOString(),
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      },
    });
  } catch (err) {
    next(err);
  }
};
