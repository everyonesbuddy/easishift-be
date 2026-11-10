const mongoose = require("mongoose");

/**
 * HQ: a government contract listing we might go after. Federal ones come in
 * from SAM.gov by themselves (noticeId); state, county and city ones are
 * added by hand with a link.
 */
const hqGovListingSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["sam", "manual"], default: "manual" },
    noticeId: { type: String, default: null }, // SAM.gov's id, for federal listings
    title: { type: String, required: true, trim: true },
    agency: { type: String, trim: true, default: "" },
    level: { type: String, enum: ["federal", "state", "county", "city", "other"], default: "federal" },
    state: { type: String, trim: true, default: "" }, // where the work is, e.g. "GA"
    solicitationNumber: { type: String, trim: true, default: "" },
    noticeType: { type: String, trim: true, default: "" }, // "Solicitation", "Sources Sought", …
    setAside: { type: String, trim: true, default: "" },
    naics: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },
    postedAt: { type: Date, default: null },
    dueAt: { type: Date, default: null }, // when the response is due
    questionsDueAt: { type: Date, default: null },
    value: { type: String, trim: true, default: "" }, // as written, e.g. "$25,000/yr"
    matched: { type: String, trim: true, default: "" }, // why the feed picked it up
    status: { type: String, enum: ["new", "reviewing", "bidding", "submitted", "won", "lost", "passed"], default: "new" },
    notes: { type: String, default: "" },
    checklist: { type: [{ text: { type: String, trim: true }, done: { type: Boolean, default: false } }], default: [] },
    statusAt: { type: Date, default: null },
  },
  { timestamps: true },
);

hqGovListingSchema.index({ noticeId: 1 }, { unique: true, partialFilterExpression: { noticeId: { $type: "string" } } });
hqGovListingSchema.index({ status: 1, dueAt: 1 });

module.exports = mongoose.model("HqGovListing", hqGovListingSchema);
