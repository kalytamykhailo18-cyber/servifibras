import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testDatabase() {
  console.log('🧪 Testing Database Schema...\n');

  try {
    // TEST 1: Create, Read, Update, Delete User
    console.log('TEST 1: User CRUD Operations');
    console.log('─'.repeat(50));

    // Create
    const testUser = await prisma.user.create({
      data: {
        email: 'brenda.test@servifibras.com',
        username: 'brenda_test',
        password: 'test_password_hash',
        name: 'Brenda Test',
        role: 'ATENCION',
      },
    });
    console.log('✅ Created user:', testUser.name, `(${testUser.id})`);

    // Read
    const retrievedUser = await prisma.user.findUnique({
      where: { id: testUser.id },
    });
    console.log('✅ Retrieved user:', retrievedUser?.name);

    // Update
    const updatedUser = await prisma.user.update({
      where: { id: testUser.id },
      data: { active: false },
    });
    console.log('✅ Updated user active status:', updatedUser.active);

    // Delete
    await prisma.user.delete({
      where: { id: testUser.id },
    });
    console.log('✅ Deleted user');

    const deletedCheck = await prisma.user.findUnique({
      where: { id: testUser.id },
    });
    console.log('✅ Verified deletion:', deletedCheck === null ? 'User not found (correct)' : 'ERROR');
    console.log('');

    // TEST 2: Conversation with Messages
    console.log('TEST 2: Conversation with Messages');
    console.log('─'.repeat(50));

    // Create contact
    const testContact = await prisma.contact.create({
      data: {
        name: 'Juan Pérez',
        phone: '+5491112345678',
        type: 'MINORISTA',
        channel: 'WHATSAPP',
      },
    });
    console.log('✅ Created contact:', testContact.name);

    // Create conversation
    const testConversation = await prisma.conversation.create({
      data: {
        contactId: testContact.id,
        channel: 'WHATSAPP',
        status: 'ACTIVE',
      },
    });
    console.log('✅ Created conversation:', testConversation.id);

    // Create 5 messages
    const messages = [];
    for (let i = 1; i <= 5; i++) {
      const message = await prisma.message.create({
        data: {
          conversationId: testConversation.id,
          sender: i % 2 === 0 ? 'CUSTOMER' : 'AI',
          content: `Test message ${i}`,
          isFromAI: i % 2 !== 0,
        },
      });
      messages.push(message);
    }
    console.log('✅ Created 5 messages');

    // Read messages back in order
    const retrievedMessages = await prisma.message.findMany({
      where: { conversationId: testConversation.id },
      orderBy: { timestamp: 'asc' },
    });
    console.log('✅ Retrieved messages in order:');
    retrievedMessages.forEach((msg, idx) => {
      console.log(`   ${idx + 1}. ${msg.sender}: ${msg.content}`);
    });
    console.log('');

    // TEST 3: Lead Management
    console.log('TEST 3: Lead Management');
    console.log('─'.repeat(50));

    // Create Franco user
    const franco = await prisma.user.create({
      data: {
        email: 'franco@servifibras.com',
        username: 'franco',
        password: 'password_hash',
        name: 'Franco',
        role: 'VENTAS',
      },
    });
    console.log('✅ Created Franco (sales):', franco.name);

    // Create lead
    const testLead = await prisma.lead.create({
      data: {
        contactId: testContact.id,
        source: 'WHATSAPP',
        productInterest: '500L polyester resin',
        estimatedValue: 5000,
        status: 'NEW',
      },
    });
    console.log('✅ Created lead:', testLead.id, '- Status:', testLead.status);

    // Assign to Franco
    const assignedLead = await prisma.lead.update({
      where: { id: testLead.id },
      data: {
        assignedTo: franco.id,
        status: 'CONTACTED',
      },
    });
    console.log('✅ Assigned to Franco - Status:', assignedLead.status);

    // Mark as won
    const wonLead = await prisma.lead.update({
      where: { id: testLead.id },
      data: {
        status: 'WON',
        wonAmount: 5500,
      },
    });
    console.log('✅ Marked as WON - Amount: USD', wonLead.wonAmount);

    // Verify saved
    const verifiedLead = await prisma.lead.findUnique({
      where: { id: testLead.id },
      include: {
        contact: true,
        assigned: true,
      },
    });
    console.log('✅ Verified lead:');
    console.log(`   - Contact: ${verifiedLead?.contact.name}`);
    console.log(`   - Assigned to: ${verifiedLead?.assigned?.name}`);
    console.log(`   - Status: ${verifiedLead?.status}`);
    console.log(`   - Won Amount: USD ${verifiedLead?.wonAmount}`);
    console.log('');

    // CLEANUP
    console.log('CLEANUP: Removing test data');
    console.log('─'.repeat(50));
    await prisma.message.deleteMany({ where: { conversationId: testConversation.id } });
    await prisma.conversation.delete({ where: { id: testConversation.id } });
    await prisma.lead.delete({ where: { id: testLead.id } });
    await prisma.contact.delete({ where: { id: testContact.id } });
    await prisma.user.delete({ where: { id: franco.id } });
    console.log('✅ All test data cleaned up');
    console.log('');

    console.log('✨ ALL TESTS PASSED ✨');
    console.log('Database schema is working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
