// models/scheduleModel.js
const mongoose = require("mongoose");

const scheduleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: [
        // Healthcare & Senior Living
        "doctor",
        "nurse",
        "receptionist",
        "billing",
        "rn", // Registered Nurse
        "lpn", // Licensed Practical Nurse
        "cna", // Certified Nursing Assistant
        "med_aide", // Medication Aide / Med Tech
        "caregiver", // Direct Care Worker
        "activity_aide",
        "dietary_aide",
        "housekeeper",

        // Police
        "police_officer",
        "police_sergeant",
        "police_detective",
        "police_patrol",
        "police_traffic",

        // Warehouse & Logistics
        "warehouse_staff",
        "forklift_operator",
        "warehouse_supervisor",
        "delivery_driver",
        "inventory_manager",
        "packer",
        "loader",

        // Security Service
        "security_guard",
        "security_supervisor",
        "patrol_officer",
        "control_room_operator",

        // Retail
        "cashier",
        "sales_associate",
        "stock_associate",
        "retail_supervisor",
        "retail_manager",
        "customer_service",

        // Hospitality
        "front_desk",
        "front_desk_manager",
        "housekeeping_staff",
        "housekeeping_supervisor",
        "chef",
        "cook",
        "server",
        "bartender",
        "host",
        "hospitality_manager",

        // Manufacturing
        "assembly_line",
        "machine_operator",
        "manufacturing_supervisor",
        "quality_control",
        "technician",
        "manufacturing_manager",

        // Education
        "teacher",
        "teacher_aide",
        "counselor",
        "librarian",
        "custodian",

        // Transportation
        "driver",
        "bus_driver",
        "truck_driver",
        "dispatcher",
        "transportation_supervisor",

        // Finance
        "accountant",
        "analyst",
        "finance_manager",
        "clerk",
        "advisor",

        // Catch-all
        "staff",
        "other",
      ],
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "call_out"],
      default: "scheduled",
    },
    notes: { type: String },
    timezone: { type: String, default: "UTC" }, // IANA timezone, for display + auditing
    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      publishedAt: Date,
    },
  },
  { timestamps: true },
);

// Simple validation: start must be before end
scheduleSchema.pre("validate", function (next) {
  if (this.startTime >= this.endTime) {
    this.invalidate("endTime", "endTime must be after startTime");
  }
  next();
});

module.exports = mongoose.model("Schedule", scheduleSchema);
