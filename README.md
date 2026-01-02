🏥 Patient Engagement & Portal Backend - README
Project Overview

This project is a multi-tenant healthcare portal built using the MERN stack (MongoDB, Express, React, Node.js).
It’s designed for private practices or hospitals, providing:

Patient portal (registration, login, forms, messages)

Staff portal (appointment management, patient management, follow-ups)

Multi-tenant support so each hospital/clinic has isolated data

Automated reminders for appointments and follow-ups

Secure communication via email/SMS

Role-based access control for staff

🚀 Features
1. Multi-Tenant Architecture

Tenant: Represents a hospital or clinic.

Each tenant has its own staff and patients.

tenantId is included in every model to isolate data.

2. Authentication & Authorization

Staff login: email + password.

Patient login: portal account created via invite token.

JWT-based authentication with middleware:

authMiddleware → verifies JWT and attaches user/patient info

tenantMiddleware → attaches tenant info

roleMiddleware → restricts routes by staff role

3. Patient Registration

Staff/admin creates patient record → generates invite token.

Patient uses token to complete portal registration.

Only patients attached to a tenant can access that tenant’s portal.

4. Appointments & Follow-Ups

Staff can create and manage appointments.

Patients can view their appointments in the portal.

Follow-ups track tasks like calls, lab tests, medications, or visits.

Cron jobs can send reminder notifications via email/SMS.

5. Forms

Patients can fill forms (intake, consent, feedback).

Staff can submit forms on behalf of patients.

Forms include status tracking: pending, reviewed, approved, rejected.

6. Messaging

Internal messaging between staff and patients.

Optional notifications via email or SMS.

🗂 Models
Model	Description
Tenant	Represents a hospital/clinic
User	Staff members: admin, doctor, nurse, receptionist
Patient	Portal users linked to a tenant
Appointment	Scheduled patient appointments
FollowUp	Tasks to track ongoing care or lab/visit follow-ups
FormSubmission	Patient or staff-submitted forms
Message	Internal messaging between staff and patients

🔧 Middleware

authMiddleware → Verifies JWT, attaches req.user or req.patient.

tenantMiddleware → Validates tenant existence, attaches req.tenant.

roleMiddleware → Restricts access to specific staff roles.

⚙️ Utilities

sendEmail.js → Sends email notifications using NodeMailer.

sendSMS.js → Sends SMS via Twilio (or any provider).

scheduleJobs.js → Cron jobs for appointment/follow-up reminders.

🛣 Routes
Route	Purpose	Middleware
/api/v1/auth/login/staff	Staff login	authMiddleware (optional)
/api/v1/auth/login/patient	Patient login	authMiddleware (optional)
/api/v1/auth/register-patient	Patient completes registration	Invite token check
/api/v1/tenants	Create/get tenants	admin only
/api/v1/patients	CRUD patient records	auth + tenant + roleMiddleware
/api/v1/appointments	CRUD appointments	auth + tenant + roleMiddleware
/api/v1/followups	Manage follow-ups	auth + tenant + roleMiddleware
/api/v1/forms	Submit/review forms	auth + tenant + roleMiddleware
/api/v1/messages	Send/receive messages	auth + tenant
🔑 Authentication Flow

Tenant created → Owner/Admin is created.

Staff added → Staff credentials stored with tenantId.

Patient invited → System generates inviteToken.

Patient completes registration → Activates portal.

JWT token issued → attached to req.user or req.patient.

📦 Project Structure
backend/
│   server.js
│   app.js
│
├── models/
│   tenantModel.js
│   userModel.js
│   patientModel.js
│   appointmentModel.js
│   followUpModel.js
│   formSubmissionModel.js
│   messageModel.js
│
├── controllers/
│   authController.js
│   tenantController.js
│   patientController.js
│   appointmentController.js
│   followUpController.js
│   formController.js
│   messageController.js
│
├── routes/
│   authRoutes.js
│   tenantRoutes.js
│   patientRoutes.js
│   appointmentRoutes.js
│   followUpRoutes.js
│   formRoutes.js
│   messageRoutes.js
│
├── middleware/
│   authMiddleware.js
│   tenantMiddleware.js
│   roleMiddleware.js
│   errorMiddleware.js
│
└── utils/
    sendEmail.js
    sendSMS.js
    scheduleJobs.js

💡 Best Practices / Notes

Always query by tenantId to ensure multi-tenant data isolation.

Use cron jobs for sending scheduled reminders.

Use roleMiddleware to enforce least privilege access.

Store sensitive info (JWT secret, email credentials, Twilio keys) in .env.

Patient portal passwords are stored hashed with bcrypt.

⚡ Getting Started

Clone repository

git clone <repo-url>
cd backend


Install dependencies

npm install


Setup .env with:

PORT=5000
DB_URL=mongodb+srv://<user>:<pass>@cluster.mongodb.net/<db>
JWT_SECRET=your_jwt_secret
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=email@example.com
EMAIL_PASS=password
TWILIO_SID=xxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_PHONE_NUMBER=+15555555555
CLIENT_URL=http://localhost:3000


- Start server

npm run dev


API ready at http://localhost:5000/api/v1/...