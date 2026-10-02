const mongoose = require("mongoose");

const tenantAssetSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    kind: {
      type: String,
      enum: ["logo"],
      required: true,
    },
    contentType: {
      type: String,
      enum: ["image/png", "image/jpeg", "image/webp"],
      required: true,
    },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

tenantAssetSchema.index({ tenantId: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model("TenantAsset", tenantAssetSchema);
