const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    userPhone: {
      type: String,
      default: null,
      trim: true,
    },
    userPhoneCountryCode: {
      type: String,
      default: null,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never return password hash in queries by default
    },
    role: {
      type: String,
      enum: [
        // Admin
        "admin",
        "superadmin",

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
      default: "staff",
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
