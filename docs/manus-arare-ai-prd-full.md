# ARARE AI PRD

## 0. Product Name

ARARE AI

Men's esthetic salon AI reception and reservation automation OS.

## 1. Purpose

ARARE AI is a SaaS product that automates and centralizes reception, reservation handling, customer management, therapist management, notification delivery, conversation history, and sales tracking for men's esthetic salons.

The product must support:

- Phone AI reception
- LINE AI reception
- Web chat AI reception
- Store onboarding
- Knowledge management for AI answers
- Reservation management
- Customer management
- Therapist and shift management
- Room availability management
- Notification and SMS management
- Sales management
- Permission management
- Production readiness and submission judgment

The product is not only an AI reservation tool. It must also include a knowledge management system so that each store can register the information that AI is allowed to reference.

## 2. Core Principle

AI must not answer from imagination.

AI must only use registered data from:

- StoreSetting
- Course
- CourseOption
- Therapist
- FAQ
- KnowledgeBase
- TalkScript
- NG response rules

If information is not registered, AI must answer:

「確認が必要です」

AI must not confirm a reservation without clear customer agreement.

## 3. Target Users

### 3.1 Platform Admin

Manages multiple stores, production readiness, integration status, submission judgment, and issue monitoring.

### 3.2 Store Owner

Manages store settings, permissions, reservations, notifications, phone AI, LINE AI, sales, and operational quality.

### 3.3 Manager

Handles day-to-day store operation, reservation confirmation, customer communication, notification resend, and shift/room coordination.

### 3.4 Staff

Checks today's reservations, AI reception logs, notification failures, customer messages, and urgent tasks.

### 3.5 Therapist

Checks assigned reservations, shift status, visit preparation, customer arrival flow, and messages from the store.

## 4. Product Positioning

PC version is the command center for owners and managers.

Smartphone version is the field operation app for staff and therapists.

Recommended UI references:

- PC: Square Dashboard, Shopify Admin, Google Calendar, LINE Official Account Manager
- Smartphone: LINE Official Account app, Instagram DM, Instagram Story queue, Uber Eats merchant app, Square POS

Do not copy these apps directly. Use them only as UX references.

## 5. Non-Goals

Do not implement the following features:

- Instagram DM integration
- X DM integration
- SNS auto posting
- Automatic ad operation
- AI sales improvement suggestions
- Fully automatic NG customer judgment
- Fully automatic same-person customer merge
- Social media growth tools
- Any feature outside the reservation/reception/store operation OS scope

## 6. Required Technology Stack

- Frontend: Next.js, TypeScript, TailwindCSS, shadcn/ui
- Backend: Next.js API Routes
- Database: PostgreSQL
- ORM: Prisma
- Auth: Clerk
- AI: OpenAI API
- Phone: Twilio Voice API
- SMS: Twilio Messaging API
- LINE: LINE Messaging API
- Hosting: Vercel
- DB Hosting: Supabase

## 7. Required Database Models

Minimum required models:

- Store
- User
- Customer
- Therapist
- Shift
- Room
- Course
- CourseOption
- Reservation
- ReservationHold
- ReservationChangeHistory
- Conversation
- Message
- KnowledgeBase
- FAQ
- TalkScript
- Notification
- NotificationLog
- SalesRecord
- BlacklistEntry
- StoreSetting
- Permission / Role mapping
- AuditLog

## 8. Store Onboarding

Store onboarding must allow registration and editing of:

- Store name
- Address
- Phone number
- Business hours
- Number of rooms
- Reservation acceptance rules
- Cancellation rules
- Attention notes
- NG response rules
- Course list
- Price table
- Options
- Therapist list
- Therapist profile
- Therapist specialties
- Nomination fee
- Supported courses
- Room information
- LINE ID settings
- Phone AI settings
- SMS settings

Saved onboarding data must be referenced by AI, admin screens, notifications, and reservation logic.

## 9. Knowledge Management

The system must provide management screens for:

- KnowledgeBase
- FAQ
- TalkScript
- NG answer rules
- Store-specific rules
- Course explanations
- Price explanations
- Therapist profiles
- Attention notes

Knowledge data must support:

- Add
- Edit
- Disable
- Search
- Category filter
- Sort order where necessary

AI must not answer using unregistered knowledge.

## 10. AI Reception

### 10.1 Phone AI

Phone AI must support:

- Twilio Voice webhook
- Incoming call handling
- Voice conversation
- Course guidance
- Price guidance
- Therapist guidance
- Availability check
- Reservation creation
- Reservation change request
- Cancellation request
- Final readback
- Escalation to store confirmation
- Call log
- Conversation summary

Phone AI must not finalize a reservation without explicit customer agreement and store-safe confirmation flow.

### 10.2 LINE AI

LINE AI must support:

- LINE Messaging API webhook
- Reservation request
- Reservation change request
- Cancellation request
- Course guidance
- Price guidance
- FAQ answer
- Store rule answer
- Customer LINE history
- Therapist LINE operational messages where required

### 10.3 Web Chat AI

Web chat must provide the same functional behavior as LINE AI:

- Reservation request
- Reservation change request
- Cancellation request
- FAQ answer
- Course guidance
- Price guidance
- Store rule answer
- Conversation history

Web chat must be embeddable on a store website or usable as a reservation entry page.

## 11. Reservation Flow

Reservation confirmation must follow this exact flow:

1. Get desired date and time
2. Get course
3. Get nomination preference
4. Get customer name
5. Get customer phone number
6. Check therapist availability
7. Check room availability
8. Create tentative reservation
9. AI reads back reservation details
10. Customer clearly agrees
11. Store/admin confirmation or approve flow finalizes reservation
12. Notification is sent

AI must not skip tentative reservation.

AI must not directly create confirmed reservations.

Reservation creation must use:

- `TENTATIVE`
- `ReservationHold`
- `approveReservation` or equivalent approval flow

Confirmed reservation must require:

- Valid hold
- Not expired
- Not rejected
- Availability recheck

## 12. Reservation Management

Required functions:

- Reservation create
- Reservation edit
- Reservation cancel
- Tentative reservation
- Confirmed reservation
- Visited
- No-show
- Therapist assignment
- Room assignment
- Double booking prevention
- Shift outside prevention
- Room shortage prevention
- Change history
- Audit log

Required statuses:

- TENTATIVE
- CONFIRMED
- VISITED
- CANCELLED
- NO_SHOW

Double booking prevention:

- Same therapist cannot be booked for overlapping active reservations.
- Same room cannot be booked for overlapping active reservations.
- Reservation confirmation must run inside a DB transaction where possible.

Shift rule:

- Reservation must be rejected if therapist is not scheduled or checked in.

Room rule:

- Reservation must be rejected if no room is available.

## 13. Customer Management

Required fields:

- Name
- Phone number
- LINE ID
- Visit history
- Nomination history
- Cancellation history
- Conversation history
- Memo
- NG flag
- Blacklist flag

Phone number duplication must be prevented per store.

LINE ID should be linked if available.

Therapist users must not see all customer information unless permitted.

## 14. Therapist Management

Required functions:

- Therapist CRUD
- Shift registration
- Shift management
- Nomination availability
- Supported courses
- Specialties
- Work status
- Nomination count
- Sales
- LINE ID registration
- Phone number

Therapist line messages may be used for shift/reporting flows if implemented within the PRD scope.

## 15. Notification

Required notification types:

- Reservation confirmed
- Reservation changed
- Reservation cancelled
- Previous day reminder
- Same day reminder
- Thank you message after visit
- Therapist reservation notification
- Notification failure alert

Required channels:

- SMS
- LINE
- Internal/admin
- Phone-related status where needed

NotificationLog is mandatory.

NotificationLog must track:

- Store
- Notification
- Reservation
- Type
- Channel
- Status
- Recipient
- Provider
- Provider message ID
- Dedupe key
- Error code
- Error message
- Payload
- Sent time

Duplicate notification sending must be prevented by NotificationLog.

SMS status callback must update NotificationLog and Notification where possible.

## 16. Sales Management

Required metrics:

- Daily sales
- Monthly sales
- Therapist sales
- Course sales
- Nomination rate
- Repeat rate
- Utilization rate

Sales calculation must exclude:

- Cancelled reservations
- No-show reservations

Sales calculation may include:

- Confirmed reservations
- Visited reservations

The exact accounting rule should be visible in the UI.

## 17. Permission Management

Required roles:

- Owner
- Manager
- Staff
- Therapist
- Platform Admin if needed

Permission rules:

- Owner can manage store settings, users, reservations, notifications, phone AI, and permissions.
- Manager can handle daily operations, reservations, notifications, phone AI settings if allowed.
- Staff can check reservations, customers, notifications, and conversation history.
- Therapist can see assigned tasks and limited reservation/customer information.

Clerk must be used for authentication.

The app must include a permission management screen.

## 18. Required Admin Screens

Must include:

- Dashboard
- Store onboarding
- Knowledge management
- FAQ management
- TalkScript management
- NG answer management
- Reservation list
- Reservation create/edit
- Customer list
- Therapist list
- Shift management
- Room management
- Course/price management
- Sales list
- Conversation log
- Notification history
- Store settings
- Permission management
- Phone AI operation
- Web Chat / reservation entry
- Operations monitoring
- Production readiness checklist
- Submission judgment dashboard

## 19. PC UI Requirements

PC is the command center.

Recommended direction:

- Square Dashboard
- Shopify Admin
- Google Calendar
- LINE Official Account Manager

PC layout:

- Dark navy left sidebar
- Top header
- Store selector
- Business status
- Notification bell
- Manager profile
- Main dashboard grid
- Compact cards
- Calendar/table/log layout
- 8px card radius
- Teal primary accent
- Red/orange/green status colors

PC dashboard must fit into one viewport as much as possible, especially the home dashboard.

PC dashboard should show:

- Reservation calendar by room
- Today's reservations
- AI reception/conversation log
- Urgent queue
- Notification failures
- Available rooms
- Working therapists
- Sales summary
- Quick actions

PC screens may scroll for long lists, but the dashboard first view must show the operational overview without requiring scrolling.

## 20. Smartphone UI Requirements

Smartphone is the field operation app.

Recommended direction:

- LINE Official Account app
- Instagram DM
- Instagram Story queue
- Uber Eats merchant app
- Square POS

Smartphone home must be designed for 390x844 viewport.

Smartphone home must fit without vertical scrolling.

If information does not fit:

- Show summary only
- Move detail to bottom sheet
- Move detail to modal
- Move detail to another tab
- Use horizontal queue where appropriate

Smartphone home must include:

- Header: store name, status, notification
- Urgent queue
- Today's reservation summary
- Available rooms
- Working therapists
- Notification failure count
- Latest AI messages
- Quick actions
- Bottom navigation

Smartphone UI must use:

- Bottom navigation
- Card feed
- Story-style urgent queue
- DM-style conversation log
- Bottom sheet for detail
- Large touch-friendly buttons
- Status badges

Smartphone UI must avoid:

- Tiny text
- Crowded tables
- Long scroll dashboards
- Input fields hidden by bottom navigation
- Too many cards on the home screen

Target smartphone height allocation:

- Header: 56px
- Urgent queue: 72px
- KPI grid: 160px
- Today's reservations: 170px
- Latest AI logs: 130px
- Quick actions: 80px
- Bottom nav: 64px
- Padding/gaps: within remaining height

## 21. Ideal UI Reference Images

Use these generated images as ideal UI references.

### 21.1 PC and Smartphone Comparison

`C:\Users\user\.codex\generated_images\019eafd8-7b78-7142-9f5e-c624cfdc6a62\ig_0fb178ca197c8bc6016a2b713bb5548191903dc59ac2ed4392.png`

### 21.2 PC Dashboard

`C:\Users\user\.codex\generated_images\019eafd8-7b78-7142-9f5e-c624cfdc6a62\ig_0fb178ca197c8bc6016a2b74fe33a08191b0694c501137d062.png`

### 21.3 Smartphone Home

`C:\Users\user\.codex\generated_images\019eafd8-7b78-7142-9f5e-c624cfdc6a62\ig_0fb178ca197c8bc6016a2b75d909c08191b7664b605ced7f46.png`

### 21.4 Smartphone AI Reception

`C:\Users\user\.codex\generated_images\019eafd8-7b78-7142-9f5e-c624cfdc6a62\ig_0fb178ca197c8bc6016a2b77426d2881919ec272d014fd8b79.png`

### 21.5 PC Reservation Operation

`C:\Users\user\.codex\generated_images\019eafd8-7b78-7142-9f5e-c624cfdc6a62\ig_0fb178ca197c8bc6016a2b781c84908191a05bb1cd94957824.png`

## 22. Additional Features Allowed

Only add features that support PRD completion and submission readiness.

Allowed additions:

- Submission judgment dashboard
- Role-based progress dashboard
- Production readiness checklist
- Reservation judgment preview
- AI answer test screen
- NotificationLog inspection screen
- SMS/LINE/Phone AI status monitor
- Role-based screen preview
- Unhandled queue
- Notification resend queue
- Audit log screen
- Change history screen
- Integration health panel

Do not add unrelated growth, advertising, or SNS features.

## 23. Error Handling Requirements

### 23.1 Double Booking

Prevent overlapping active reservations for the same therapist or room.

### 23.2 Shift Outside Booking

Reject reservation if therapist is not working.

### 23.3 Room Shortage

Reject reservation if no room is available.

### 23.4 AI Unauthorized Confirmation

AI must not finalize reservation without tentative reservation, readback, and explicit agreement/approval flow.

### 23.5 Hallucinated Answer

AI must answer only from registered data.

### 23.6 Nonexistent Course

AI must not guide nonexistent courses.

### 23.7 Unauthorized Discount

AI must not negotiate or propose discounts.

### 23.8 LINE Notification Failure

Failure reason must be saved to NotificationLog.

### 23.9 Duplicate Notification

NotificationLog must prevent duplicate sending.

### 23.10 Time Zone

Display time must be JST.

DB time handling must be consistent.

### 23.11 Duplicate Customer

Phone number must be unique per store.

### 23.12 Reservation Change Mistake

Do not delete old reservation data silently.

Save before/after history.

### 23.13 Cancelled Sales

Cancelled and no-show reservations must not be counted as sales.

### 23.14 Phone AI Mishearing

Date, time, course, name, and phone number must be read back.

### 23.15 Unauthorized Reservation Change

Verify phone number and reservation information before change.

### 23.16 OpenAI Cost

Do not send all history every time.

Summarize conversation history where appropriate.

### 23.17 Permission Leak

Therapist must not see all customer data.

## 24. Production Readiness

The product is not submission-ready unless the following are verified:

- Production DB migration applied
- Production URL works
- Clerk role login verified
- LINE production webhook receives real event
- Twilio real call verified
- Real SMS callback reflected in DB
- Reservation confirmed through one full production flow
- SMS notification sent
- DB updated
- Store screen updated
- PC UI checked
- Smartphone UI checked
- NotificationLog dedupe checked
- AI registered-data-only behavior checked

If any item is missing, the product must be reported as:

提出不可

## 25. Reporting Rules

Every completion report must separate:

- 確認済み
- 未確認
- 推測
- 実装上の判断
- 要ユーザー対応

Do not report unverified production behavior as verified.

Do not say submission-ready unless every production readiness item is verified.

## 26. Deliverables

Required deliverables:

- Source code
- Prisma schema
- Migrations
- README
- `.env.example`
- PC screenshots
- Smartphone screenshots
- Implemented / not implemented list
- Test procedure
- Production setup procedure
- External service setup checklist
- Unverified items
- Submission judgment report

## 27. MVP Completion Conditions

MVP is complete only when:

- Admin can create reservations
- LINE can create reservation requests
- Web chat can create reservation requests
- Phone AI can create reservation requests
- Double booking is prevented
- Shift outside booking is prevented
- Room shortage blocks reservation
- AI answers only from registered information
- Notification duplicate sending is prevented
- Sales calculation is correct
- README exists
- `.env.example` exists
- PC UI is usable
- Smartphone UI is usable
- Production E2E evidence exists

## 28. Development Order

Recommended order:

1. Prisma schema
2. Authentication
3. Store settings
4. Course management
5. Therapist management
6. Shift management
7. Room management
8. Customer management
9. Reservation CRUD
10. Double booking prevention
11. Knowledge management
12. FAQ management
13. TalkScript management
14. LINE AI
15. Web chat AI
16. Phone AI
17. Notification
18. NotificationLog dedupe
19. Sales aggregation
20. Permission management
21. PC UI polish
22. Smartphone UI polish
23. Production readiness dashboard
24. README and setup docs
25. Production E2E verification

## 29. Manus-Specific Instruction

Build this as a separate implementation or prototype unless explicitly instructed otherwise.

Do not modify the existing Codex repository directly unless the user provides that repository and asks for integration.

Focus especially on:

- PC command center UI
- Smartphone one-screen operation UI
- Intuitive staff workflow
- Registered-data-only AI behavior
- Reservation safety
- NotificationLog
- Production readiness reporting

When uncertain, choose the safer operational behavior.

Do not claim production verification unless actually performed.
