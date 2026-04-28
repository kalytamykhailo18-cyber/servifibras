# Servifibras Backend API

Multi-channel customer service platform with AI automation for Servifibras.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database and API keys

# Run database migrations
npx prisma migrate deploy

# Seed database (optional)
npm run seed

# Start development server
npm run dev

# Server runs on http://localhost:3001
```

## 📖 Documentation

- **[Complete API Documentation](./docs/API_DOCUMENTATION.md)** - Full reference for all endpoints
- **[Frontend Quickstart Guide](./docs/FRONTEND_QUICKSTART.md)** - Quick integration guide for UI developers

## 🏗️ Architecture

Built using **Clean Architecture** principles:

```
src/
├── domain/          # Business entities and rules
├── use-cases/       # Application business logic interfaces
├── adapters/        # Interface implementations
└── infrastructure/  # Frameworks, controllers, external services
```

## ✨ Features

### Phase 1: Core Infrastructure ✅
- Database schema with Prisma ORM
- Clean architecture setup
- PostgreSQL database

### Phase 2: AI Integration ✅
- Anthropic Claude integration
- Automated pricing calculations
- Knowledge base retrieval
- Context-aware responses

### Phase 3: Multi-Channel Communication ✅
- WhatsApp Business API
- Facebook Messenger
- Instagram Direct Messages
- MercadoLibre messaging
- TiendaNube webchat

### Phase 4: Admin Dashboard API ✅
- JWT authentication & authorization
- Conversation management (7 endpoints)
- Contact management (8 endpoints)
- Knowledge base management (10 endpoints)
- Analytics dashboard (8 endpoints)
- Configuration management (16 endpoints)

### Phase 5: Sales & Order Management ✅
- Lead management (8 endpoints)
- Order fulfillment tracking (8 endpoints)
- Sales pipeline statistics
- Revenue analytics

**Total: 74 admin API endpoints**

## 🔐 Authentication

All admin endpoints require JWT Bearer token authentication.

```bash
# 1. Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@servifibras.com","password":"yourpassword"}'

# 2. Use token in requests
curl -X GET http://localhost:3001/admin/conversations \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🎯 API Endpoints Overview

### Authentication
- `POST /auth/login` - Login and get JWT token
- `GET /auth/profile` - Get current user profile

### Conversations (7 endpoints)
- `GET /admin/conversations` - List conversations
- `GET /admin/conversations/:id` - Get conversation details
- `POST /admin/conversations/:id/takeover` - Manual takeover
- `POST /admin/conversations/:id/message` - Send message
- More...

### Contacts (8 endpoints)
- `GET /admin/contacts` - List contacts
- `POST /admin/contacts` - Create contact
- `PUT /admin/contacts/:id` - Update contact
- `DELETE /admin/contacts/:id` - Delete contact
- More...

### Knowledge Base (10 endpoints)
- `GET /admin/knowledge` - List knowledge items
- `POST /admin/knowledge` - Create knowledge item
- `GET /admin/knowledge/categories` - Get categories
- More...

### Analytics (8 endpoints)
- `GET /admin/analytics/dashboard` - Dashboard summary
- `GET /admin/analytics/conversations/metrics` - Conversation metrics
- `GET /admin/analytics/ai/performance` - AI performance
- More...

### Configuration (16 endpoints)
- `GET /admin/configuration` - List configurations
- `PUT /admin/configuration/ai/settings` - Update AI settings
- `PUT /admin/configuration/channel/:channel` - Update channel config
- More...

### Leads (8 endpoints)
- `GET /admin/leads` - List leads
- `POST /admin/leads` - Create lead
- `PUT /admin/leads/:id/status` - Update lead status
- `GET /admin/leads/stats/pipeline` - Pipeline statistics
- More...

### Orders (8 endpoints)
- `GET /admin/orders` - List orders
- `POST /admin/orders` - Create order
- `PUT /admin/orders/:id/status` - Update order status
- `PUT /admin/orders/:id/tracking` - Update tracking info
- `GET /admin/orders/stats/summary` - Order statistics
- More...

See [API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md) for complete details.

## 🧪 Testing

All features are covered by E2E tests:

```bash
# Phase 4: Admin Dashboard
npm run test:auth           # Authentication (16/16 tests)
npm run test:conversations  # Conversations (20/20 tests)
npm run test:contacts       # Contacts (22/22 tests)
npm run test:knowledge      # Knowledge Base (27/27 tests)
npm run test:analytics      # Analytics (20/20 tests)
npm run test:configuration  # Configuration (26/26 tests)

# Phase 5: Sales & Orders
npm run test:leads          # Lead Management (23/23 tests)
npm run test:orders         # Order Management (23/23 tests)

# Phase tests
npm run test:phase2         # AI Integration
npm run test:phase3         # Multi-channel
```

**Total: 177 passing E2E tests**

## 🗄️ Database Schema

Key models:
- `User` - Admin users with roles (ADMIN, AGENT, VIEWER)
- `Contact` - Customer contacts across channels
- `Conversation` - Multi-channel conversations
- `Message` - Individual messages (customer, AI, human agent)
- `KnowledgeBase` - Product knowledge and FAQs
- `Configuration` - System, channel, AI, pricing settings
- `Lead` - Sales pipeline management
- `Order` - Confirmed sales and fulfillment

## 🔧 Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/servifibras_db

# JWT Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=24h

# Server
PORT=3001

# AI (Anthropic Claude)
ANTHROPIC_API_KEY=your-anthropic-api-key

# Channels (configure as needed)
WHATSAPP_API_KEY=your-whatsapp-key
FACEBOOK_PAGE_ACCESS_TOKEN=your-facebook-token
INSTAGRAM_ACCESS_TOKEN=your-instagram-token
MERCADOLIBRE_ACCESS_TOKEN=your-ml-token
```

## 📦 Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** NestJS
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** JWT with bcrypt
- **AI:** Anthropic Claude API
- **Testing:** Custom E2E test suite

## 👥 User Roles & Permissions

| Permission | ADMIN | AGENT | VIEWER |
|------------|-------|-------|--------|
| View conversations | ✅ | ✅ | ✅ |
| Take over conversations | ✅ | ✅ | ❌ |
| Manage knowledge base | ✅ | ✅ | ❌ |
| View analytics | ✅ | ✅ | ✅ |
| Manage users | ✅ | ❌ | ❌ |
| Manage configuration | ✅ | ❌ | ❌ |

## 🚦 Getting Started for Frontend Developers

1. **Read the docs:**
   - [Frontend Quickstart Guide](./docs/FRONTEND_QUICKSTART.md)
   - [API Documentation](./docs/API_DOCUMENTATION.md)

2. **Get credentials:**
   - Request test user credentials from backend team
   - Or create user via database seed

3. **Test the API:**
   - Use curl, Postman, or the provided examples
   - Start with login endpoint
   - All admin endpoints require Bearer token

4. **Build your UI:**
   - Use React, Vue, Angular, or any frontend framework
   - Consume the REST API endpoints
   - Implement authentication flow
   - Build dashboard, conversations, contacts, etc.

## 📈 Roadmap

- [x] Phase 1: Core Infrastructure
- [x] Phase 2: AI Integration
- [x] Phase 3: Multi-Channel Communication
- [x] Phase 4: Admin Dashboard API
- [x] Phase 5: Sales & Order Management
- [ ] Phase 6: Advanced Features (TBD)
- [ ] Frontend UI (Separate project)

## 🤝 Contributing

1. Follow Clean Architecture principles
2. Write E2E tests for new features
3. Update API documentation
4. Follow TypeScript best practices

## 📝 License

Proprietary - Servifibras

## 🆘 Support

For API questions or issues:
- See documentation in `/docs`
- Check E2E tests in `/src/tests` for usage examples
- Contact development team

---

**API Version:** 1.0.0
**Last Updated:** April 27, 2026
