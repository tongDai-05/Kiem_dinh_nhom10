'use strict';

// These requests are only run against the isolated Postman fixture environment.
module.exports = ({ r, login, logout }) => {
  const profileChecks = [
    "pm.test('Hồ sơ đúng khách A', () => { pm.expect(pm.response.text()).to.include(pm.environment.get('user_account')); });",
    "pm.test('Hồ sơ không hiển thị mật khẩu thử', () => { pm.expect(pm.response.text()).not.to.include(pm.environment.get('password')); });",
    "pm.test('Hồ sơ không hiển thị chuỗi băm bcrypt', () => { pm.expect(pm.response.text()).not.to.match(/\\$2[aby]\\$\\d{2}\\$/); });",
  ];
  const privatePageChecks = [
    "pm.test('Nếu chuyển hướng thì phải về đăng nhập', () => { if (pm.response.code === 302) pm.expect(pm.response.headers.get('Location')).to.equal('/auth/login'); });",
    "pm.test('Không trả địa chỉ riêng của đơn B', () => { pm.expect(pm.response.text()).not.to.include('PM_PRIVATE_ADDRESS_API18'); });",
    "pm.test('Không trả điện thoại riêng của đơn B', () => { pm.expect(pm.response.text()).not.to.include('0900090018'); });",
  ];
  return [
    {
      id: 'API-01', title: 'Khách chưa đăng nhập không được xem hồ sơ',
      data: 'Không gửi phiên đăng nhập; yêu cầu nhận JSON.',
      expected: 'Máy chủ trả 401 và success bằng false; không trả thông tin hồ sơ.',
      scope: 'Một yêu cầu đọc hồ sơ ở phiên mới, đối chiếu mã HTTP, JSON và nội dung riêng tư.',
      requests: [r('Đọc hồ sơ khi chưa đăng nhập', 'GET', '/auth/profile', {
        status: 401, json: { success: false },
        tests: ["pm.test('Không có thông tin khách A trong phản hồi', () => { pm.expect(pm.response.text()).not.to.include(pm.environment.get('user_account')); });"],
      })],
      async verify({ db, check }) { check(await db.collection('users').countDocuments({}), 4, 'Đọc trái quyền không tạo hoặc xóa tài khoản'); },
    },
    {
      id: 'API-02', title: 'Đăng nhập đúng, đăng xuất và phát lại phiên cũ',
      data: 'Tài khoản khách A và mật khẩu thử hợp lệ; lưu cookie do chính lượt đăng nhập cấp để phát lại sau đăng xuất.',
      expected: 'Đăng nhập mở đúng hồ sơ; sau đăng xuất, cả phiên mới lẫn cookie cũ đều bị từ chối với 401.',
      scope: 'Kiểm tra đăng nhập bằng tên, nội dung hồ sơ, hủy phiên và một lượt phát lại cookie cũ; không ghi giá trị cookie trong báo cáo.',
      requests: [
        login('user', { tests: [
          "const raw = pm.response.headers.all().filter(h => h.key.toLowerCase() === 'set-cookie').map(h => h.value).join('; '); const match = raw.match(/(?:^|;\\s*)(connect\\.sid=[^;]+)/); pm.test('Đăng nhập cấp cookie phiên', () => { pm.expect(Boolean(match)).to.equal(true); }); if (match) pm.environment.set('old_session', match[1]);",
        ] }),
        r('Đọc hồ sơ sau đăng nhập', 'GET', '/auth/profile', { status: 200, tests: profileChecks }),
        logout(),
        r('Đọc hồ sơ sau đăng xuất', 'GET', '/auth/profile', { status: 401, json: { success: false } }),
        r('Phát lại cookie cũ sau đăng xuất', 'GET', '/auth/profile', { status: 401, json: { success: false }, headers: { Cookie: '{{old_session}}' } }),
      ],
      async verify({ db, f, check }) {
        const user = await db.collection('users').findOne({ _id: f.user.id });
        check(user.account, f.user.account, 'Đăng nhập và đăng xuất không làm đổi tài khoản khách A');
      },
    },
    {
      id: 'API-03', title: 'Đăng nhập bằng email vào đúng tài khoản',
      data: 'Email khách A và mật khẩu thử hợp lệ.',
      expected: 'Đăng nhập chuyển về trang chủ; hồ sơ có tên đăng nhập của cùng khách A, không lộ mật khẩu.',
      scope: 'Một lượt đăng nhập bằng email, đọc hồ sơ rồi đăng xuất.',
      requests: [
        r('Đăng nhập khách A bằng email', 'POST', '/auth/login', { form: { account: '{{user_email}}', password: '{{password}}' }, status: 302, location: '/?login_success=1' }),
        r('Hồ sơ sau đăng nhập bằng email', 'GET', '/auth/profile', { status: 200, tests: profileChecks }),
        logout(),
      ],
    },
    {
      id: 'API-04', title: 'Sai hoặc thiếu thông tin đăng nhập không được cấp quyền',
      data: 'Một lượt sai mật khẩu; một lượt thiếu tên đăng nhập; một lượt thiếu mật khẩu.',
      expected: 'Sai mật khẩu chuyển về đăng nhập. Thiếu trường trả 422. Mỗi lượt đều không được đọc hồ sơ.',
      scope: 'Ba yêu cầu đăng nhập không hợp lệ và kiểm tra quyền ngay sau từng yêu cầu; chưa bao quát mọi độ dài hoặc kiểu dữ liệu.',
      requests: [
        r('Đăng nhập sai mật khẩu', 'POST', '/auth/login', { form: { account: '{{user_account}}', password: 'PostmanPasswordWrong!' }, status: 302, location: '/auth/login' }),
        r('Hồ sơ sau mật khẩu sai vẫn bị chặn', 'GET', '/auth/profile', { status: 401, json: { success: false } }),
        r('Đăng nhập thiếu tài khoản', 'POST', '/auth/login', { form: { account: '', password: '{{password}}' }, status: 422 }),
        r('Hồ sơ sau lượt thiếu tài khoản vẫn bị chặn', 'GET', '/auth/profile', { status: 401, json: { success: false } }),
        r('Đăng nhập thiếu mật khẩu', 'POST', '/auth/login', { form: { account: '{{user_account}}', password: '' }, status: 422 }),
        r('Hồ sơ sau lượt thiếu mật khẩu vẫn bị chặn', 'GET', '/auth/profile', { status: 401, json: { success: false } }),
      ],
      async verify({ db, check }) { check(await db.collection('users').countDocuments({}), 4, 'Các lượt đăng nhập không hợp lệ không làm đổi số tài khoản'); },
    },
    {
      id: 'API-05', title: 'Khách chưa đăng nhập không được thêm giỏ',
      data: 'Yêu cầu thêm sản phẩm mẫu màu Đen, cỡ M, số lượng 1 từ phiên chưa đăng nhập.',
      expected: 'Trả 401, success bằng false và giỏ của mọi tài khoản giữ nguyên.',
      scope: 'Một yêu cầu thêm giỏ trực tiếp, kiểm tra phản hồi và giỏ trong database tạm.',
      requests: [r('Thêm giỏ khi chưa đăng nhập', 'POST', '/cart/add', { body: { productID: '{{product_id}}', type: 'Đen', size: 'M', orderNumber: 1 }, status: 401, json: { success: false } })],
      async verify({ db, check }) {
        const users = await db.collection('users').find({}).toArray();
        check(users.map(u => (u.carts || []).length).sort(), [0, 0, 0, 0], 'Không có giỏ tài khoản nào bị thay đổi bởi khách chưa đăng nhập');
      },
    },
    {
      id: 'API-16', title: 'Khách A không được hủy đơn của khách B',
      data: 'Khách A đăng nhập; gửi mã đơn Chờ duyệt thuộc khách B.',
      expected: 'Trả 403, success bằng false; đơn của B giữ chủ sở hữu, trạng thái và tổng tiền.',
      scope: 'Một lượt hủy trái quyền và đối chiếu bản ghi đơn trong database tạm.',
      requests: [login('user'), r('Khách A hủy đơn của B', 'POST', '/order/cancel', { body: { orderId: '{{pending_order_id}}' }, status: 403, json: { success: false } })],
      async verify({ db, f, check }) {
        const order = await db.collection('orders').findOne({ _id: f.pendingOrder.id });
        check(order.status, 'pending', 'Đơn của B giữ trạng thái Chờ duyệt sau hủy trái quyền');
        check(String(order.user), String(f.otherUser.id), 'Đơn vẫn thuộc khách B');
        check(order.totalAmount, 300000, 'Tổng tiền đơn của B không đổi');
      },
    },
    {
      id: 'API-17', title: 'Chủ đơn được hủy đúng trạng thái và không được hủy lặp',
      data: 'Khách B đăng nhập; đơn Chờ duyệt, đơn Đã giao và một lần gửi hủy lặp.',
      expected: 'Hủy Chờ duyệt thành công; gửi lại bị từ chối 400; đơn Đã giao bị từ chối 400 và giữ nguyên trạng thái.',
      scope: 'Kiểm tra hủy của chủ đơn với một trạng thái hợp lệ, một trạng thái kết thúc và thao tác lặp tuần tự; chưa kiểm tra cạnh tranh.',
      requests: [
        login('other'),
        r('Khách B hủy đơn Chờ duyệt của mình', 'POST', '/order/cancel', { body: { orderId: '{{pending_order_id}}' }, status: 200, json: { success: true } }),
        r('Khách B gửi hủy lặp', 'POST', '/order/cancel', { body: { orderId: '{{pending_order_id}}' }, status: 400, json: { success: false } }),
        r('Khách B thử hủy đơn Đã giao', 'POST', '/order/cancel', { body: { orderId: '{{delivered_order_id}}' }, status: 400, json: { success: false } }),
      ],
      async verify({ db, f, check }) {
        const pending = await db.collection('orders').findOne({ _id: f.pendingOrder.id });
        const delivered = await db.collection('orders').findOne({ _id: f.deliveredOrder.id });
        const waiting = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
        check(pending.status, 'cancelled', 'Đơn Chờ duyệt của chủ đơn chuyển sang Đã hủy');
        check(delivered.status, 'delivered', 'Đơn Đã giao không bị hủy');
        check(waiting.status, 'waiting', 'Đơn không được chọn vẫn ở Chờ giao');
        check(await db.collection('orders').countDocuments({}), 3, 'Các lượt hủy không tạo hoặc xóa đơn khác');
      },
    },
    {
      id: 'API-18', title: 'Bảo vệ thông tin xác nhận đơn trước phiên ngoài chủ đơn',
      data: 'Đơn B có địa chỉ và số điện thoại giả riêng; mở bằng khách chưa đăng nhập rồi bằng khách A.',
      expected: 'Theo tiêu chí bảo vệ dữ liệu đề xuất, ngoài chủ đơn phải bị từ chối 401 hoặc 403, hoặc chuyển về đăng nhập; không trả địa chỉ và điện thoại đơn B.',
      scope: 'Hai phiên ngoài chủ đơn với cùng mã đơn tồn tại. Đây là kiểm tra quyền sở hữu dữ liệu, không phải chỉ kiểm tra trang mở được.',
      async prepare({ db, f }) {
        await db.collection('orders').updateOne({ _id: f.pendingOrder.id }, { $set: { 'shippingAddress.address': 'PM_PRIVATE_ADDRESS_API18', 'shippingAddress.phone': '0900090018', shipAddress: 'PM_PRIVATE_ADDRESS_API18' } });
      },
      requests: [
        r('Phiên chưa đăng nhập đọc xác nhận đơn B', 'GET', '/order/checkout?orderId={{pending_order_id}}', { status: [401, 403, 302], tests: privatePageChecks }),
        login('user'),
        r('Khách A đọc cùng xác nhận đơn B', 'GET', '/order/checkout?orderId={{pending_order_id}}', { status: [401, 403, 302], tests: privatePageChecks }),
      ],
      async verify({ db, f, check }) {
        const order = await db.collection('orders').findOne({ _id: f.pendingOrder.id });
        check(order.status, 'pending', 'Các lượt xem không làm đổi trạng thái đơn B');
        check(String(order.user), String(f.otherUser.id), 'Đơn được xem vẫn thuộc khách B');
      },
    },
    {
      id: 'API-22', title: 'Khách thường không có quyền shipper hoặc quản trị',
      data: 'Tài khoản khách A dùng mật khẩu đúng trên ứng dụng khách và cổng quản trị; thử đọc và duyệt đơn.',
      expected: 'API shipper trả 403. Dù cổng quản trị có nhận đăng nhập, trang sản phẩm và thao tác duyệt phải chuyển về đăng nhập; đơn giữ Chờ duyệt.',
      scope: 'Đối chiếu quyền thực tế sau đăng nhập ở cả hai ứng dụng; không coi chuyển hướng sau đăng nhập là đã có quyền quản trị.',
      requests: [
        login('user'),
        r('Khách A gọi chức năng nhận đơn shipper', 'POST', '/shipper/accept', { body: { orderId: '{{waiting_order_id}}' }, status: 403, json: { success: false } }),
        r('Khách A đăng nhập cổng quản trị', 'POST', '/login', { admin: true, form: { account: '{{user_account}}', password: '{{password}}' }, status: 302, location: '/dashboard' }),
        r('Khách A đọc danh sách sản phẩm quản trị', 'GET', '/products', { admin: true, status: 302, location: '/login' }),
        r('Khách A gửi duyệt đơn qua cổng quản trị', 'POST', '/orders/approved', { admin: true, form: { id: '{{pending_order_id}}' }, status: 302, location: '/login' }),
      ],
      async verify({ db, f, check }) {
        check((await db.collection('orders').findOne({ _id: f.pendingOrder.id })).status, 'pending', 'Khách thường không duyệt được đơn');
        check((await db.collection('orders').findOne({ _id: f.waitingOrder.id })).status, 'waiting', 'Khách thường không nhận được đơn giao');
        check((await db.collection('users').findOne({ _id: f.user.id })).role, 'User', 'Vai trò khách A không đổi');
      },
    },
    {
      id: 'API-23', title: 'Shipper nhận và giao đơn, ghi tiền công một lần',
      data: 'Shipper thử, đơn Chờ giao trị giá 300.000 đồng; tiền công ban đầu 0.',
      expected: 'Nhận và giao đều thành công; đơn Đã giao có ngày giao và đúng shipper. Tiền công 12.000 đồng; gửi giao lặp trả 400 và không cộng thêm.',
      scope: 'Luồng nhận, đọc lịch sử, giao, gửi lặp tuần tự và đọc biểu đồ; đối chiếu trạng thái, thu nhập, lịch sử trong database.',
      requests: [
        login('shipper'),
        r('Shipper nhận đơn Chờ giao', 'POST', '/shipper/accept', { body: { orderId: '{{waiting_order_id}}' }, status: 200, json: { success: true } }),
        r('Lịch sử sau nhận có tiền công bằng 0', 'GET', '/shipper/history/filter?status=shipping', { status: 200, json: { success: true }, tests: ["pm.test('Nhận đơn chưa cộng tiền công', () => { const history = pm.response.json().history; pm.expect(history).to.have.lengthOf(1); pm.expect(history[0].earning).to.equal(0); pm.expect(history[0].status).to.equal('shipping'); });"] }),
        r('Shipper giao thành công', 'POST', '/shipper/deliver', { body: { orderId: '{{waiting_order_id}}' }, status: 200, json: { success: true } }),
        r('Shipper gửi xác nhận giao lặp', 'POST', '/shipper/deliver', { body: { orderId: '{{waiting_order_id}}' }, status: 400, json: { success: false } }),
        r('Lịch sử chỉ có một lượt giao thành công', 'GET', '/shipper/history/filter?status=delivered', { status: 200, json: { success: true }, tests: ["pm.test('Một lịch sử giao với tiền công 12.000 đồng', () => { const history = pm.response.json().history; pm.expect(history).to.have.lengthOf(1); pm.expect(history[0].earning).to.equal(12000); pm.expect(history[0].status).to.equal('delivered'); });"] }),
        r('Biểu đồ tiền công sau giao', 'GET', '/shipper/earnings/chart', { status: 200, json: { success: true }, tests: ["pm.test('Tổng tiền công biểu đồ là 12.000 đồng', () => { const values = Object.values(pm.response.json().chartData); pm.expect(values.reduce((a,b) => a+b, 0)).to.equal(12000); });"] }),
      ],
      async verify({ db, f, check }) {
        const order = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
        const shipper = await db.collection('shippers').findOne({ user: f.shipper.id });
        const delivered = (shipper.orderHistory || []).filter(h => h.status === 'delivered' && String(h.order) === String(f.waitingOrder.id));
        check(order.status, 'delivered', 'Đơn chuyển sang Đã giao');
        check(String(order.shiperID), String(f.shipper.id), 'Đơn gán đúng shipper thực hiện');
        check(Boolean(order.shipDate), true, 'Đơn có ngày giao');
        check(shipper.totalEarnings, 12000, 'Thu nhập chỉ tăng một lần lên 12.000 đồng');
        check(delivered.length, 1, 'Chỉ có một lịch sử giao thành công cho đơn');
        check(delivered[0]?.earning, 12000, 'Tiền công lịch sử đúng 12.000 đồng');
      },
    },
    {
      id: 'API-24', title: 'Shipper không được giao hoặc hủy đơn gán cho người khác',
      data: 'Đơn đang giao được gán một định danh khác shipper đang đăng nhập; tổng tiền 300.000 đồng.',
      expected: 'Cả giao và hủy đều bị từ chối 400; người được gán, trạng thái, lịch sử và thu nhập giữ nguyên.',
      scope: 'Hai yêu cầu trái người được giao trên cùng đơn ở trạng thái Đang giao; chưa kiểm tra nhận đơn cạnh tranh.',
      async prepare({ db, f }) {
        await db.collection('orders').updateOne({ _id: f.waitingOrder.id }, { $set: { status: 'shipping', shiperID: f.otherUser.id } });
      },
      requests: [
        login('shipper'),
        r('Shipper thử giao đơn được gán cho người khác', 'POST', '/shipper/deliver', { body: { orderId: '{{waiting_order_id}}' }, status: 400, json: { success: false } }),
        r('Shipper thử hủy đơn được gán cho người khác', 'POST', '/shipper/cancel', { body: { orderId: '{{waiting_order_id}}' }, status: 400, json: { success: false } }),
      ],
      async verify({ db, f, check }) {
        const order = await db.collection('orders').findOne({ _id: f.waitingOrder.id });
        const shipper = await db.collection('shippers').findOne({ user: f.shipper.id });
        check(order.status, 'shipping', 'Đơn gán cho người khác vẫn ở Đang giao');
        check(String(order.shiperID), String(f.otherUser.id), 'Người được gán đơn không bị ghi đè');
        check(Boolean(order.shipDate), false, 'Không tự tạo ngày giao cho yêu cầu trái người được gán');
        check(shipper.totalEarnings, 0, 'Thu nhập shipper không đổi sau yêu cầu trái quyền');
        check((shipper.orderHistory || []).length, 0, 'Không thêm lịch sử cho yêu cầu trái quyền');
      },
    },
  ];
};
