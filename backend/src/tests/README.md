# Test Scripts

This directory contains all test scripts for the Servifibras backend.

## Running Tests

All tests can be run from the backend directory using:

```bash
npx ts-node src/tests/<test-file>.ts
```

## Available Tests

### Phase 1 Tests

#### `test-database.ts`
**Purpose:** Test database schema and CRUD operations
**Tests:**
- Prisma connection
- User CRUD operations
- Conversation + Messages
- Lead management
- All database relationships

**Run:**
```bash
npx ts-node src/tests/test-database.ts
```

---

### Phase 2 Tests

#### `test-ai.ts`
**Purpose:** Test Claude AI integration
**Tests:**
- ClaudeService initialization
- Health check
- Simple questions
- Conversation continuation

**Run:**
```bash
npx ts-node src/tests/test-ai.ts
```

**Requires:** `CLAUDE_API_KEY` in .env

---

#### `test-product-knowledge.ts`
**Purpose:** Test knowledge base and AI product questions
**Tests:**
- Load knowledge from database
- Search functionality
- Format for AI consumption
- AI answers product questions

**Run:**
```bash
npx ts-node src/tests/test-product-knowledge.ts
```

**Requires:** Knowledge base seeded (`npm run seed`)

---

#### `test-pricing.ts`
**Purpose:** Test pricing calculator
**Tests:**
- Exchange rate service (dólar blue)
- Product search
- Retail pricing (no discounts)
- Volume discounts (5%, 10%, 15%)
- Wholesale discounts (mayorista 10%)
- Discount stacking
- Spanish formatted output

**Run:**
```bash
npx ts-node src/tests/test-pricing.ts
```

---

#### `test-ai-pricing.ts`
**Purpose:** Test AI + Pricing Calculator integration
**Tests:**
- Tool calling architecture
- calculate_price tool definition
- AI recognizes pricing questions
- AI returns prices in Spanish

**Run:**
```bash
npx ts-node src/tests/test-ai-pricing.ts
```

**Requires:** `CLAUDE_API_KEY` in .env

---

#### `test-phase2-e2e.ts`
**Purpose:** Comprehensive Phase 2 end-to-end test
**Tests:**
- Knowledge Base (4 tests)
- Pricing Calculator (9 tests)
- AI Integration (2 tests)
- HTTP Endpoints (6 tests)
- **Total: 21 tests**

**Run:**
```bash
npx ts-node src/tests/test-phase2-e2e.ts
```

**Coverage:**
- All Phase 2 functionality
- All HTTP endpoints
- Real API calls (exchange rate)
- Mock products
- AI architecture

---

### Phase 3 Tests

#### `test-whatsapp.ts`
**Purpose:** Test WhatsApp Business API integration
**Tests:**
- WhatsAppService architecture
- Webhook endpoints
- Message parsing
- Send message API
- Signature verification

**Run:**
```bash
npx ts-node src/tests/test-whatsapp.ts
```

**Requires (for live tests):**
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

---

#### `test-whatsapp-ai.ts`
**Purpose:** Test WhatsApp + AI integration
**Tests:**
- ConversationHandlerService
- WhatsApp → AI flow
- Conversation persistence
- Multi-turn conversations
- Error handling

**Run:**
```bash
npx ts-node src/tests/test-whatsapp-ai.ts
```

**Requires:**
- WhatsApp credentials (see above)
- `CLAUDE_API_KEY`
- Database seeded

**Expected Flow:**
1. Customer sends WhatsApp message
2. Webhook receives → mark read → 200 OK
3. Async: Process with AI
4. AI responds with knowledge + pricing
5. Send response via WhatsApp
6. Save conversation to database

---

## Test Categories

### Architecture Tests
Tests that verify structure without requiring API credentials:
- `test-ai.ts` (without API key)
- `test-pricing.ts` (exchange rate only)
- `test-whatsapp.ts` (without credentials)
- `test-whatsapp-ai.ts` (without credentials)

These tests verify:
- Services initialize correctly
- Modules load
- Dependencies inject properly
- Graceful degradation works

### Integration Tests
Tests that require API credentials:
- `test-ai.ts` (with `CLAUDE_API_KEY`)
- `test-ai-pricing.ts` (with `CLAUDE_API_KEY`)
- `test-whatsapp.ts` (with WhatsApp credentials)
- `test-whatsapp-ai.ts` (with all credentials)

### End-to-End Tests
Complete system tests:
- `test-phase2-e2e.ts` - All Phase 2 functionality (21 tests)
- `test-database.ts` - All database operations

---

## Quick Start

### Test Everything (Architecture Only)
```bash
npx ts-node src/tests/test-phase2-e2e.ts
```

### Test With Real APIs
1. Add credentials to `.env`
2. Run specific test:
```bash
npx ts-node src/tests/test-whatsapp-ai.ts
```

### Check Test Coverage
```bash
# Phase 1
npx ts-node src/tests/test-database.ts

# Phase 2
npx ts-node src/tests/test-phase2-e2e.ts

# Phase 3
npx ts-node src/tests/test-whatsapp.ts
npx ts-node src/tests/test-whatsapp-ai.ts
```

---

## Expected Results

All tests should show:
- ✅ Green checkmarks for passed tests
- Architecture verified messages
- Clear instructions for what's needed
- No TypeScript errors
- No server crashes

If a test requires credentials and they're not configured:
- Test shows architecture verification ✅
- Clear instructions on how to configure
- Expected behavior documented
- No failures, just warnings

---

## Troubleshooting

**Test won't run:**
```bash
# Make sure you're in the backend directory
cd /home/Marcos/servifibras/backend
npx ts-node src/tests/<test-name>.ts
```

**Import errors:**
```bash
# Rebuild TypeScript
npm run build
```

**Database errors:**
```bash
# Re-seed database
npm run seed
```

**Server not running:**
```bash
# Start server
npm start
```

---

## Adding New Tests

When creating a new test:
1. Name it `test-<feature>.ts`
2. Place in this directory
3. Follow existing test structure
4. Add documentation here
5. Update this README

Example structure:
```typescript
async function testFeature() {
  console.log('🧪 Testing Feature');
  console.log('═'.repeat(70));

  // Architecture verification (always works)
  console.log('ARCHITECTURE VERIFICATION:');
  console.log('✅ Service created');
  console.log('✅ Module loaded');

  // Check if configured
  const isConfigured = process.env.SOME_KEY !== '';

  if (!isConfigured) {
    console.log('⚠️  Not configured. Architecture test only.');
    return;
  }

  // Real tests with API
  console.log('Running live tests...');
  // ... test code
}

testFeature();
```
