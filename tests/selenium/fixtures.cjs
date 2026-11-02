'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { MongoMemoryServer } = require('mongodb-memory-server');
const userRequire = createRequire(path.resolve(__dirname, '../../user/package.json'));
const mongoose = userRequire('mongoose');
const bcrypt = userRequire('bcryptjs');
const { MongoClient, ObjectId } = mongoose.mongo;

// This module only connects to the temporary mongod it creates itself.
// It deliberately does not accept MONGODB_URI or a connection to the user's DB.
async function createFixtures() {
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: 'webbtl_selenium', ip: '127.0.0.1' },
    binary: {
      version: '7.0.14',
      downloadDir: path.resolve(__dirname, '../.cache/mongodb-binaries'),
    },
  });
  const uri = mongo.getUri('webbtl_selenium');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('webbtl_selenium');
    const id = () => new ObjectId();
    const password = 'SeleniumTest123!';
    const fixture = {
      user: { id: id(), account: 'selenium_customer', password, name: 'Khách Selenium A', gmail: 'customer@example.test', address: 'Địa chỉ kiểm thử Selenium', phone: '0900000001' },
      otherUser: { id: id(), account: 'selenium_other', password, name: 'Khách Selenium B', gmail: 'other@example.test', address: 'Địa chỉ kiểm thử B', phone: '0900000002' },
      shipper: { id: id(), account: 'selenium_shipper', password, name: 'Shipper Selenium', gmail: 'shipper@example.test', address: 'Địa chỉ kiểm thử shipper', phone: '0900000003' },
      admin: { id: id(), account: 'selenium_admin', password, name: 'Quản trị Selenium', gmail: 'admin@example.test', address: 'Địa chỉ kiểm thử quản trị', phone: '0900000004' },
      category: { id: id(), name: 'Áo Selenium' },
      otherCategory: { id: id(), name: 'Quần Selenium' },
      product: { id: id(), name: 'Áo Selenium Alpha', type: 'Đen', detail: [{ size: 'M', price: 120000, stock: 5 }, { size: 'L', price: 150000, stock: 3 }] },
      otherProduct: { id: id(), name: 'Quần Selenium Alpha', type: 'Đen', detail: [{ size: 'M', price: 90000, stock: 5 }] },
      thirdProduct: { id: id(), name: 'Áo Selenium Beta', type: 'Trắng', detail: [{ size: 'M', price: 200000, stock: 5 }] },
      pendingOrder: { id: id() }, deliveredOrder: { id: id() }, waitingOrder: { id: id() },
    };
    const hashedPassword = await bcrypt.hash(password, 10);
    // A small embedded fixture image avoids a dependency on product image URLs.
    const image = { imageName: 'selenium.png', imageType: 'image/png', imageData: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') };
    async function reset(caseId) {
      if (db.databaseName !== 'webbtl_selenium' || !uri.startsWith('mongodb://127.0.0.1:')) {
        throw new Error('Refusing to reset a database outside this temporary test environment.');
      }
      for (const name of ['users', 'products', 'categories', 'orders', 'shippers', 'user_app_sessions', 'adminsessions']) {
        await db.collection(name).deleteMany({});
      }
      const cart = (size, count) => ({ productID: fixture.product.id, type: fixture.product.type, size, orderNumber: count });
      const users = [fixture.user, fixture.otherUser, fixture.shipper, fixture.admin].map((u) => ({
        _id: u.id, account: u.account, password: hashedPassword, name: u.name,
        gmail: u.gmail, phone: u.phone, address: u.address,
        role: u === fixture.shipper ? 'Shipper' : u === fixture.admin ? 'Admin' : 'User',
        carts: u === fixture.user && caseId === 'UI-05' ? [cart('M', 1), cart('L', 1)]
          : u === fixture.user && caseId === 'UI-06' ? [cart('L', 2)] : [],
        orders: [], wishlist: [], reviewProducts: [],
      }));
      await db.collection('users').insertMany(users);
      const products = [fixture.product, fixture.otherProduct, fixture.thirdProduct].map((p) => ({
        _id: p.id, name: p.name, type: p.type, detail: p.detail,
        category: p === fixture.otherProduct ? fixture.otherCategory.id : fixture.category.id,
        description: 'Sản phẩm mẫu dành riêng cho kiểm thử Selenium.', image, reviewProducts: [],
      }));
      await db.collection('products').insertMany(products);
      await db.collection('categories').insertMany([
        { _id: fixture.category.id, name: fixture.category.name, products: products.filter((p) => p.category.equals(fixture.category.id)), image },
        { _id: fixture.otherCategory.id, name: fixture.otherCategory.name, products: products.filter((p) => p.category.equals(fixture.otherCategory.id)), image },
      ]);
      const order = (key, status) => ({
        _id: fixture[key].id, user: fixture.otherUser.id, status,
        orderDate: new Date('2026-10-01T03:00:00Z'), totalAmount: 300000,
        items: [{ product: fixture.product.id, name: fixture.product.name, group: fixture.product.type, size: 'L', price: 150000, quantity: 2, image }],
        shippingAddress: { fullName: 'Người nhận kiểm thử', address: 'Địa chỉ giả lập Selenium', phone: '0900000005', email: 'receiver@example.test' },
        shipAddress: 'Địa chỉ giả lập Selenium', paymentMethod: 'cod', paymentStatus: 'unpaid',
      });
      await db.collection('orders').insertMany([order('pendingOrder', 'pending'), order('deliveredOrder', 'delivered'), order('waitingOrder', 'waiting')]);
      await db.collection('shippers').insertOne({ user: fixture.shipper.id, totalEarnings: 0, orderHistory: [] });
    }
    return { uri, db, fixture, reset, async close() { try { await client.close(); } finally { await mongo.stop(); } } };
  } catch (error) {
    try { await client.close(); } finally { await mongo.stop(); }
    throw error;
  }
}

module.exports = { createFixtures };
