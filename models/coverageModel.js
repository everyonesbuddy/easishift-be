const mongoose = require("mongoose");

const coverageSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    // Always stored as start-of-day UTC
    date: {
      type: Date,
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

        // AL / IL tags for Healthcare & Senior Living
        "al_doctor",
        "al_nurse",
        "al_receptionist",
        "al_billing",
        "al_rn",
        "al_lpn",
        "al_cna",
        "al_med_aide",
        "al_caregiver",
        "al_activity_aide",
        "al_dietary_aide",
        "al_housekeeper",
        "il_doctor",
        "il_nurse",
        "il_receptionist",
        "il_billing",
        "il_rn",
        "il_lpn",
        "il_cna",
        "il_med_aide",
        "il_caregiver",
        "il_activity_aide",
        "il_dietary_aide",
        "il_housekeeper",

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
    },

    endTime: {
      type: Date,
      required: true,
    },

    requiredCount: {
      type: Number,
      default: 1,
      min: 0,
    },

    note: { type: String },
  },
  { timestamps: true },
);

// Prevent duplicate coverage/shifts entries for same tenant, date, role, and shift time
coverageSchema.index(
  { tenantId: 1, date: 1, role: 1, startTime: 1, endTime: 1 },
  { unique: true },
);

module.exports = mongoose.model("Coverage", coverageSchema);
