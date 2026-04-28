#!/bin/bash

# ============================================
# Frontend Build Verification Script
# ============================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Verifying Frontend Build...${NC}\n"

# Check Node.js version
echo "1. Checking Node.js version..."
NODE_VERSION=$(node -v)
echo -e "   Node.js version: ${GREEN}$NODE_VERSION${NC}"

# Check if dependencies are installed
echo "2. Checking dependencies..."
if [ -d "node_modules" ]; then
  echo -e "   ${GREEN}✓ Dependencies installed${NC}"
else
  echo -e "   ${RED}✗ Dependencies not installed. Run 'npm install'${NC}"
  exit 1
fi

# Check if .env.local exists
echo "3. Checking environment variables..."
if [ -f ".env.local" ]; then
  echo -e "   ${GREEN}✓ .env.local exists${NC}"
  API_URL=$(grep NEXT_PUBLIC_API_BASE_URL .env.local | cut -d '=' -f2)
  echo -e "   API URL: ${GREEN}$API_URL${NC}"
else
  echo -e "   ${YELLOW}⚠ .env.local not found. Copy from .env.local.example${NC}"
fi

# Run TypeScript type check
echo "4. Running TypeScript type check..."
npx tsc --noEmit > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✓ No TypeScript errors${NC}"
else
  echo -e "   ${RED}✗ TypeScript errors found${NC}"
  npx tsc --noEmit
  exit 1
fi

# Build the project
echo "5. Building production bundle..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✓ Build successful${NC}"
else
  echo -e "   ${RED}✗ Build failed${NC}"
  npm run build
  exit 1
fi

# Check build output
echo "6. Checking build output..."
if [ -d ".next" ]; then
  echo -e "   ${GREEN}✓ .next directory created${NC}"
  BUILD_SIZE=$(du -sh .next | cut -f1)
  echo -e "   Build size: ${GREEN}$BUILD_SIZE${NC}"
else
  echo -e "   ${RED}✗ Build output not found${NC}"
  exit 1
fi

# Count pages
echo "7. Analyzing pages..."
PAGE_COUNT=$(find .next/server/app -name "*.js" -o -name "*.html" | wc -l)
echo -e "   Generated pages: ${GREEN}$PAGE_COUNT${NC}"

echo -e "\n${GREEN}✅ Build verification complete!${NC}\n"
echo -e "To start the production server, run: ${YELLOW}npm start${NC}"
