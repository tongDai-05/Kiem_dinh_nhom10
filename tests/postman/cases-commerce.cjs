'use strict';

module.exports = ({ r, login }) => {
  let approvalBefore = [];
  const cart = (f, size, orderNumber, product = f.product) => ({ productID: product.id, type: product.type, size, orderNumber });
  const add = (label, size, number, more = {}) => r(label, 'POST', '/cart/add', {
    body: { productID: '{{product_id}}', type: 'Đen', size, orderNumber: number },
    status: 200, json: { success: true }, ...more,
  });
  const address = { fullName: 'Người nhận kiểm thử Postman', address: 'Địa chỉ giả lập Postman', phone: '0900000099', email: 'receiver@example.test' };
  const savedCart = async (db, f) => (await db.collection('users').findOne({ _id: f.user.id })).carts;
  const compact = (items) => items.map(x => ({ productID: String(x.productID), type: x.type, size: x.size, quantity: x.orderNumber }));
  const stock = async (db, id) => (await db.collection('products').findOne({ _id: id })).detail.map(x => ({ size: x.size, stock: x.stock }));
  const newOrders = (db, f) => db.collection('orders').find({ user: f.user.id }).toArray();
  const setCart = async (db, f, items) => db.collection('users').updateOne({ _id: f.user.id }, { $set: { carts: items } });
  const identity = (f, size, quantity, product = f.product) => ({ productID: String(product.id), type: product.type, size, quantity });
  return [
    {
      id: 'API-06', title: 'Thêm hai chiếc L vào giỏ bằng yêu cầu hợp lệ',
      data: 'Khách A, giỏ rỗng; Áo Alpha Đen, M giá 120.000 đồng còn 5, L giá 150.000 đồng còn 3. Gửi số lượng 2 dạng số JSON.',
      expected: 'Máy chủ xác nhận thành công, lưu đúng một dòng L hai chiếc; chưa tạo đơn và chưa giảm kho.',
      scope: 'Đăng nhập bằng API và thêm giỏ qua API; đối chiếu giỏ và tồn thực trong database tạm.',
      requests: [login(), add('Thêm Đen L hai chiếc', 'L', 2)],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [identity(f, 'L', 2)], 'Giỏ lưu đúng L hai chiếc');
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 3 }], 'Thêm giỏ chưa làm giảm tồn kho');
        check((await newOrders(db, f)).length, 0, 'Thêm giỏ chưa tạo đơn hàng');
      },
    },
    {
      id: 'API-07', title: 'Cộng số lượng cùng biến thể với dữ liệu JSON số',
      data: 'Giỏ rỗng; lần lượt thêm Đen M một chiếc và hai chiếc, cả hai số lượng đều là số JSON.',
      expected: 'Hai lần thêm được hợp nhất thành một dòng M ba chiếc, không tạo hai dòng trùng nhau.',
      scope: 'Hai lần thêm thực sự qua API; đối chiếu dữ liệu đã lưu sau lần thứ hai.',
      requests: [login(), add('Thêm M một chiếc', 'M', 1), add('Thêm tiếp M hai chiếc bằng JSON số', 'M', 2)],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [identity(f, 'M', 3)], 'Cùng biến thể được cộng thành ba chiếc');
      },
    },
    {
      id: 'API-08', title: 'Cộng số lượng khi biểu mẫu gửi giá trị dạng chuỗi',
      data: 'Thêm Đen M một chiếc bằng JSON số; lần thứ hai gửi orderNumber=2 bằng biểu mẫu URL-encoded.',
      expected: 'Máy chủ đọc số lượng hợp lệ và cộng thành ba chiếc; không nối chuỗi thành 12.',
      scope: 'Đối chiếu hai kiểu dữ liệu gửi cùng một nghiệp vụ; không giả định dữ liệu biểu mẫu là số JSON.',
      requests: [login(), add('Thêm M một chiếc bằng JSON số', 'M', 1), r('Thêm tiếp M hai chiếc bằng biểu mẫu', 'POST', '/cart/add', {
        form: { productID: '{{product_id}}', type: 'Đen', size: 'M', orderNumber: '2' }, status: 200, json: { success: true },
      })],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [identity(f, 'M', 3)], 'Biểu mẫu phải cộng số lượng một và hai thành ba');
      },
    },
    {
      id: 'API-09', title: 'Thay đổi số lượng đúng dòng size L',
      data: 'Chuẩn bị trực tiếp trong database tạm giỏ Đen M một chiếc và L hai chiếc. Gửi yêu cầu sửa L thành ba chiếc.',
      expected: 'Chỉ dòng L đổi thành ba; M vẫn một chiếc. Nhận diện dòng theo đủ sản phẩm, màu và size là tiêu chí toàn vẹn giỏ.',
      scope: 'Giỏ ban đầu được chuẩn bị trong database; thao tác sửa được gửi qua API, có bổ sung type và size để kiểm tra có chọn đúng dòng hay không.',
      async prepare({ db, f }) { await setCart(db, f, [cart(f, 'M', 1), cart(f, 'L', 2)]); },
      requests: [login(), r('Sửa số lượng dòng L thành ba', 'POST', '/cart/update', {
        body: { productId: '{{product_id}}', type: 'Đen', size: 'L', qty: 3 }, status: 200, json: { success: true },
      })],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [identity(f, 'M', 1), identity(f, 'L', 3)], 'Sửa L phải giữ nguyên M và lưu L ba chiếc');
      },
    },
    {
      id: 'API-10', title: 'Xóa dòng L và giữ nguyên dòng M',
      data: 'Chuẩn bị trực tiếp trong database tạm giỏ Đen M một chiếc và L hai chiếc; xóa riêng L.',
      expected: 'Dòng L được xóa; M vẫn một chiếc và tồn kho không đổi.',
      scope: 'Thao tác xóa qua API với đủ sản phẩm, màu và size; đối chiếu toàn giỏ sau khi lưu.',
      async prepare({ db, f }) { await setCart(db, f, [cart(f, 'M', 1), cart(f, 'L', 2)]); },
      requests: [login(), r('Xóa riêng Đen L khỏi giỏ', 'POST', '/cart/remove', {
        body: { productId: '{{product_id}}', type: 'Đen', size: 'L' }, status: 200, json: { success: true },
      })],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [identity(f, 'M', 1)], 'Xóa L không làm mất hoặc đổi số lượng M');
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 3 }], 'Xóa giỏ không thay đổi kho');
      },
    },
    {
      id: 'API-11', title: 'Từ chối thêm số lượng vượt tồn kho',
      data: 'Giỏ rỗng, Đen M còn 5; gửi số lượng 6 dạng số JSON.',
      expected: 'Theo tiêu chí số lượng không vượt tồn đã đề xuất, máy chủ báo không thành công và không ghi dòng giỏ sáu chiếc.',
      scope: 'Kiểm tra trực tiếp phía máy chủ, không phụ thuộc giới hạn ô nhập trên giao diện; không suy rộng thành đã thử tranh mua đồng thời.',
      requests: [login(), r('Thử thêm sáu chiếc khi chỉ còn năm', 'POST', '/cart/add', {
        body: { productID: '{{product_id}}', type: 'Đen', size: 'M', orderNumber: 6 }, status: [200, 400, 422], json: { success: false },
      })],
      async verify({ db, f, check }) {
        check(compact(await savedCart(db, f)), [], 'Yêu cầu vượt kho không được lưu vào giỏ');
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 3 }], 'Yêu cầu bị từ chối không làm giảm kho');
      },
    },
    {
      id: 'API-12', title: 'Không tin giá mua ngay do khách gửi lên',
      data: 'Đen M có giá tin cậy 120.000 đồng, còn 5. Khách gửi mua ngay một chiếc nhưng sửa giá thành 1 đồng.',
      expected: 'Theo tiêu chí bảo vệ giá, máy chủ từ chối tạo đơn hoặc tính lại đúng giá 120.000 đồng; không tạo đơn giá 1 đồng.',
      scope: 'Một lượt sửa giá trực tiếp trên yêu cầu JSON, trên database tạm; đối chiếu tổng và giá dòng đơn nếu đơn được tạo.',
      requests: [login(), r('Mua ngay M một chiếc với giá bị sửa thành một đồng', 'POST', '/order/quick-order', {
        body: { productId: '{{product_id}}', name: '{{product_name}}', type: 'Đen', size: 'M', price: 1, quantity: 1, shippingAddress: address },
        status: [200, 400, 422],
      })],
      async verify({ db, f, check }) {
        const orders = await newOrders(db, f);
        check(orders.length <= 1, true, 'Một yêu cầu không được tạo nhiều đơn');
        if (orders.length === 0) {
          check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 3 }], 'Nếu từ chối giá sửa, tồn kho phải giữ nguyên');
        } else {
          check(orders[0].totalAmount, 120000, 'Đơn được chấp nhận phải có tổng theo giá tin cậy');
          check(orders[0].items.map(x => ({ price: x.price, quantity: x.quantity, size: x.size })), [{ price: 120000, quantity: 1, size: 'M' }], 'Giá dòng đơn không được lấy giá một đồng từ khách');
        }
      },
    },
    {
      id: 'API-13', title: 'Đặt giỏ L hai chiếc đúng giá và đúng kho',
      data: 'Chuẩn bị trực tiếp giỏ L hai chiếc, M còn 5 và L còn 3; địa chỉ người nhận là dữ liệu giả lập Postman.',
      expected: 'Tạo đúng một đơn L hai chiếc, giá 150.000 đồng mỗi chiếc, tổng 300.000 đồng; L còn 1, M giữ 5; giỏ được xóa.',
      scope: 'Gửi đặt toàn giỏ qua tuyến đặt hàng chính, không gửi lại tên hoặc giá để tránh chuyển sang nhánh mua ngay.',
      async prepare({ db, f }) { await setCart(db, f, [cart(f, 'L', 2)]); },
      requests: [login(), r('Đặt toàn giỏ L hai chiếc', 'POST', '/order/quick-order', {
        body: { shippingAddress: address }, status: 200, json: { success: true },
      })],
      async verify({ db, f, check }) {
        const orders = await newOrders(db, f);
        check(orders.length, 1, 'Đặt toàn giỏ tạo đúng một đơn mới cho khách A');
        if (orders[0]) {
          check(orders[0].totalAmount, 300000, 'Tổng đơn L hai chiếc là 300.000 đồng');
          check(orders[0].items.map(x => ({ size: x.size, quantity: x.quantity, price: x.price })), [{ size: 'L', quantity: 2, price: 150000 }], 'Dòng đơn giữ đúng L, giá và số lượng');
          check(orders[0].shippingAddress, address, 'Thông tin người nhận được lưu đúng');
        }
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 1 }], 'Giảm đúng kho L, giữ nguyên M');
        check(compact(await savedCart(db, f)), [], 'Giỏ được xóa sau khi tạo đơn thành công');
      },
    },
    {
      id: 'API-14', title: 'Đặt giỏ thất bại không làm mất kho mặt hàng trước',
      data: 'Chuẩn bị trực tiếp giỏ A M một chiếc đứng trước B M một chiếc. A còn 5, B được đặt tồn 0 trong database tạm.',
      expected: 'Máy chủ từ chối do B hết hàng, không tạo đơn và giữ giỏ; theo tiêu chí toàn bộ hoặc không thay đổi, kho A vẫn 5 và B vẫn 0.',
      scope: 'Một lượt đặt nhiều dòng tuần tự trên database thật dành riêng cho kiểm thử; không phải thử tranh mua hoặc chủ động gây lỗi lưu.',
      async prepare({ db, f }) {
        await db.collection('products').updateOne({ _id: f.otherProduct.id }, { $set: { 'detail.0.stock': 0 } });
        await setCart(db, f, [cart(f, 'M', 1), cart(f, 'M', 1, f.otherProduct)]);
      },
      requests: [login(), r('Đặt giỏ có A còn hàng trước B hết hàng', 'POST', '/order/quick-order', {
        body: { shippingAddress: address }, status: 400, json: { success: false },
      })],
      async verify({ db, f, check }) {
        check((await newOrders(db, f)).length, 0, 'Đặt thiếu hàng không tạo đơn mới');
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 3 }], 'Đặt thất bại phải giữ nguyên kho A');
        check(await stock(db, f.otherProduct.id), [{ size: 'M', stock: 0 }], 'Kho B vẫn bằng không');
        check(compact(await savedCart(db, f)), [identity(f, 'M', 1), identity(f, 'M', 1, f.otherProduct)], 'Đặt thất bại giữ nguyên hai dòng giỏ');
      },
    },
    {
      id: 'API-15', title: 'Đặt giỏ qua tuyến cũ vẫn phải đúng giá và kho',
      data: 'Chuẩn bị trực tiếp giỏ L hai chiếc, M còn 5 và L còn 3; gửi tuyến đặt giỏ cũ.',
      expected: 'Dù đi qua tuyến đặt giỏ cũ, đơn phải có tổng 300.000 đồng, giá L 150.000 đồng, giảm L còn 1 và giữ M còn 5.',
      scope: 'Kiểm tra riêng POST đặt giỏ cũ, phân biệt với tuyến đặt hàng chính; đối chiếu đơn và kho trong database tạm.',
      async prepare({ db, f }) { await setCart(db, f, [cart(f, 'L', 2)]); },
      requests: [login(), r('Đặt L hai chiếc qua tuyến đặt giỏ cũ', 'POST', '/cart/checkout', {
        body: { shippingAddress: address }, status: 200, json: { success: true },
      })],
      async verify({ db, f, check }) {
        const orders = await newOrders(db, f);
        check(orders.length, 1, 'Tuyến đặt giỏ cũ tạo đúng một đơn');
        if (orders[0]) {
          check(orders[0].totalAmount, 300000, 'Tổng đơn tuyến cũ phải khớp hai chiếc L');
          check(orders[0].items.map(x => ({ size: x.size, quantity: x.quantity, price: x.price })), [{ size: 'L', quantity: 2, price: 150000 }], 'Dòng đơn tuyến cũ giữ đúng giá L');
        }
        check(await stock(db, f.product.id), [{ size: 'M', stock: 5 }, { size: 'L', stock: 1 }], 'Tuyến đặt giỏ cũ phải giảm đúng kho L');
        check(compact(await savedCart(db, f)), [], 'Giỏ được xóa sau đặt qua tuyến cũ');
      },
    },
    {
      id: 'API-19', title: 'Quản trị tạo sản phẩm có hai size hợp lệ',
      data: 'Tên mới Áo Postman API19, màu Đen; M giá 120.000 đồng tồn 5, L giá 150.000 đồng tồn 3.',
      expected: 'Quản trị viên tạo đúng một sản phẩm và lưu đầy đủ tên, màu, mô tả, hai size, giá và tồn.',
      scope: 'Tạo sản phẩm bằng JSON trên API quản trị; đọc lại database tạm. Ca này không bao gồm sửa, xóa hoặc tải ảnh sản phẩm.',
      requests: [login('admin'), r('Tạo sản phẩm hai size bằng tài khoản quản trị', 'POST', '/products/store', {
        admin: true, body: { name: 'Áo Postman API19', type: 'Đen', description: 'Sản phẩm riêng cho kiểm thử Postman API19.', price: { M: 120000, L: 150000 }, stock: { M: 5, L: 3 } }, status: 302, location: '/products',
      })],
      async verify({ db, check }) {
        const products = await db.collection('products').find({ name: 'Áo Postman API19' }).toArray();
        check(products.length, 1, 'Tạo đúng một sản phẩm theo tên mới');
        if (products[0]) {
          check(products[0].type, 'Đen', 'Lưu đúng màu của sản phẩm mới');
          check(products[0].description, 'Sản phẩm riêng cho kiểm thử Postman API19.', 'Lưu đúng mô tả sản phẩm mới');
          check(products[0].detail.map(x => ({ size: x.size, price: x.price, stock: x.stock })), [{ size: 'M', price: 120000, stock: 5 }, { size: 'L', price: 150000, stock: 3 }], 'Sản phẩm mới lưu đủ hai size với giá và kho đúng');
        }
      },
    },
    {
      id: 'API-20', title: 'Quản trị phải từ chối giá âm và tồn kho âm',
      data: 'Hai yêu cầu độc lập: Áo Postman API20 Giá âm có giá M -1, tồn 5; Áo Postman API20 Kho âm có giá M 120.000, tồn -1.',
      expected: 'Theo tiêu chí dữ liệu sản phẩm không âm, cả hai yêu cầu phải bị từ chối và không thêm sản phẩm sai vào database.',
      scope: 'Hai lượt JSON gửi trực tiếp phía máy chủ; không thử toàn bộ miền giá, kho hoặc kiểu dữ liệu khác.',
      requests: [login('admin'),
        r('Thử tạo sản phẩm có giá âm', 'POST', '/products/store', { admin: true, body: { name: 'Áo Postman API20 Giá âm', type: 'Đen', description: 'Dữ liệu sai riêng cho kiểm thử.', price: { M: -1 }, stock: { M: 5 } }, status: [302, 400, 422] }),
        r('Thử tạo sản phẩm có tồn kho âm', 'POST', '/products/store', { admin: true, body: { name: 'Áo Postman API20 Kho âm', type: 'Đen', description: 'Dữ liệu sai riêng cho kiểm thử.', price: { M: 120000 }, stock: { M: -1 } }, status: [302, 400, 422] }),
      ],
      async verify({ db, check }) {
        check(await db.collection('products').countDocuments({ name: 'Áo Postman API20 Giá âm' }), 0, 'Sản phẩm giá âm không được lưu');
        check(await db.collection('products').countDocuments({ name: 'Áo Postman API20 Kho âm' }), 0, 'Sản phẩm tồn kho âm không được lưu');
        for (const name of ['Áo Postman API20 Giá âm', 'Áo Postman API20 Kho âm']) {
          const docs = await db.collection('products').find({ name }).toArray();
          check(docs.flatMap(p => p.detail.map(x => ({size:x.size,price:x.price,stock:x.stock}))), [], 'Không có chi tiết sản phẩm sai được lưu: '+name);
        }
      },
    },
    {
      id: 'API-21', title: 'Duyệt đúng đơn chờ và giữ nguyên đơn không hợp lệ',
      data: 'Có một đơn Chờ duyệt, một đơn Đã giao và một đơn Chờ giao độc lập. Duyệt đơn chờ hai lần rồi thử duyệt đơn đã giao.',
      expected: 'Lần đầu chỉ đổi đơn Chờ duyệt thành Chờ giao. Lần lặp không thay nội dung; đơn đã giao và đơn khác giữ nguyên.',
      scope: 'Ba yêu cầu duyệt tuần tự bằng tài khoản quản trị; đối chiếu trạng thái, nội dung và số đơn. Không thử hai người duyệt đồng thời.',
      async prepare({ db }) {
        approvalBefore = await db.collection('orders').find({}).toArray();
      },
      requests: [login('admin'),
        r('Duyệt đơn đang chờ duyệt', 'POST', '/orders/approved', { admin: true, body: { id: '{{pending_order_id}}' }, status: 302, location: '/orders' }),
        r('Duyệt lặp lại cùng đơn', 'POST', '/orders/approved', { admin: true, body: { id: '{{pending_order_id}}' }, status: 302, location: '/orders' }),
        r('Thử duyệt đơn đã giao', 'POST', '/orders/approved', { admin: true, body: { id: '{{delivered_order_id}}' }, status: 302, location: '/orders' }),
      ],
      async verify({ db, f, check }) {
        const orders = await db.collection('orders').find({}).toArray();
        check(orders.length, 3, 'Duyệt đơn không làm tăng hoặc mất số đơn');
        check(approvalBefore.length, 3, 'Đã ghi đủ ba đơn trước khi duyệt để đối chiếu');
        for (const old of approvalBefore) {
          const now = orders.find(x => String(x._id) === String(old._id));
          const expected = { ...old, ...(String(old._id) === String(f.pendingOrder.id) ? { status: 'waiting' } : {}) };
          check(now, expected, String(old._id) === String(f.pendingOrder.id) ? 'Chỉ trạng thái đơn chờ duyệt đổi sang Chờ giao' : 'Đơn không thuộc lượt duyệt hợp lệ giữ nguyên toàn bộ nội dung');
        }
      },
    },
  ];
};
