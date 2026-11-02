// user/controllers/pageController.js
const Product = require('../models/ProductModel'); //
const Category = require('../models/CategoryModel'); //
const User = require('../models/UserModel'); // Thêm ở đầu file nếu chưa có

exports.getHomePage = async (req, res, next) => {
    try {
        console.log('GET / - Trang chủ');
        const rawProducts = await Product.find().sort({ createdAt: -1 });

        const groupedProducts = {};
        rawProducts.forEach(prod => {
            if (!groupedProducts[prod.name]) {
                const img = prod.image && prod.image.imageData
                    ? `data:${prod.image.imageType};base64,${prod.image.imageData.toString('base64')}`
                    : '/img/product-placeholder.png';

                groupedProducts[prod.name] = {
                    _id: prod._id,
                    name: prod.name,
                    description: prod.description,
                    image: img,
                    types: [],
                    reviewProducts: [],
                    isNew: prod.isNew || false
                };
            }
            groupedProducts[prod.name].types.push({
                type: prod.type,
                detail: prod.detail
            });
            if (Array.isArray(prod.reviewProducts) && prod.reviewProducts.length > 0) {
                groupedProducts[prod.name].reviewProducts.push(...prod.reviewProducts);
            }
        });

        const popularProducts = Object.values(groupedProducts).map(p => {
            let validPrices = [];
            let allOut = true;
            p.types.forEach(t => {
                if (Array.isArray(t.detail)) {
                    t.detail.forEach(d => {
                        const s = Number(d.stock) || 0;
                        const pr = Number(d.price) || 0;
                        if (s > 0 && pr > 0) {
                            allOut = false;
                            validPrices.push(pr);
                        }
                    });
                }
            });

            const totalReviews = p.reviewProducts.length;
            const totalStars = p.reviewProducts.reduce((sum, r) => sum + (r.star || 0), 0);
            const avgRating = totalReviews > 0 ? (totalStars / totalReviews) : 0;
            const displayRating = Math.floor(avgRating + 0.5 * (avgRating % 1 >= 0.5 ? 1 : 0));

            return {
                _id: p._id,
                name: p.name,
                description: p.description,
                image: p.image,
                price: validPrices.length > 0 ? Math.min(...validPrices) : 0,
                isOutOfStock: allOut,
                rating: avgRating,
                displayRating: displayRating,
                ratingCount: totalReviews,
                isNew: p.isNew
            };
        }).slice(0, 6); // Lấy tối đa 6 sản phẩm nổi bật

        const categories = await Category.find({});
        let wishlistCount = 0;
        let cartCount = 0;
        let wishlist = [];
        if (req.session.user) {
            const user = await User.findById(req.session.user._id);
            wishlistCount = user && user.wishlist ? user.wishlist.length : 0;
            cartCount = user && user.carts ? user.carts.reduce((sum, item) => sum + (item.orderNumber || 0), 0) : 0;
            if (user && user.wishlist) wishlist = user.wishlist;
        }

        console.log('Dữ liệu render index:', { popularProductsCount: popularProducts.length, categoriesCount: categories.length });
        res.render('pages/index', {
            title: 'Trang Chủ',
            products: popularProducts,
            popularProducts,
            categories,
            wishlist,
            wishlistCount,
            cartCount
        });
    } catch (err) {
        console.error('Lỗi getHomePage:', err);
        next(err);
    }
};

exports.getCartPage = async (req, res) => {
    try {
        // Truyền toàn bộ đối tượng cart từ session, hoặc một đối tượng cart rỗng nếu chưa có
        const sessionCart = req.session.cart || { items: [], itemsPrice: 0, taxPrice: 0, shippingPrice: 0, totalPrice: 0 };

        let wishlistCount = 0;
        let cartCount = 0;
        if (req.session.user) {
            const user = await User.findById(req.session.user._id);
            wishlistCount = user && user.wishlist ? user.wishlist.length : 0;
            cartCount = user && user.carts ? user.carts.reduce((sum, item) => sum + (item.orderNumber || 0), 0) : 0;
        }
        res.render('cart', {
            title: 'Shopping Cart',
            path: '/cart',
            user: req.user,
            cart: sessionCart,
            wishlistCount,
            cartCount
        });
    } catch (error) {
        console.error(error);
        res.status(500).render('error', { title: 'Error', message: 'Server Error', user: req.user, path: '/500' });
    }
};

exports.getContactPage = async (req, res, next) => {
    try {
        console.log('GET /contact');
        const categories = await Category.find({});
        let wishlistCount = 0;
        let cartCount = 0;
        if (req.session.user) {
            const user = await User.findById(req.session.user._id);
            wishlistCount = user && user.wishlist ? user.wishlist.length : 0;
            cartCount = user && user.carts ? user.carts.reduce((sum, item) => sum + (item.orderNumber || 0), 0) : 0;
        }
        res.render('pages/contact', {
            title: 'Liên Hệ',
            categories,
            wishlistCount,
            cartCount
        });
    } catch (err) {
        console.error('Lỗi getContactPage:', err);
        next(err);
    }
};

exports.getAboutPage = async (req, res, next) => {
    try {
        console.log('GET /about');
        const categories = await Category.find({});
        let wishlistCount = 0;
        let cartCount = 0;
        if (req.session.user) {
            const user = await User.findById(req.session.user._id);
            wishlistCount = user && user.wishlist ? user.wishlist.length : 0;
            cartCount = user && user.carts ? user.carts.reduce((sum, item) => sum + (item.orderNumber || 0), 0) : 0;
        }
        res.render('pages/about', {
            title: 'Về Chúng Tôi',
            categories,
            wishlistCount,
            cartCount
        });
    } catch (err) {
        console.error('Lỗi getAboutPage:', err);
        next(err);
    }
};

exports.getElementsPage = async (req, res, next) => {
    return res.redirect('/');
};

// Hàm mới để xử lý đăng ký nhận tin
exports.handleSubscription = async (req, res, next) => {
    try {
        const email = req.body.email; // Lấy email từ form POST
        if (email) {
            console.log(`Email đăng ký nhận tin: ${email}`);
            // TODO: Thêm logic lưu email vào cơ sở dữ liệu hoặc dịch vụ email marketing
            // Ví dụ: await Subscriber.create({ email });

            // Sau khi xử lý, bạn có thể gửi thông báo thành công hoặc chuyển hướng
            // req.flash('success_msg', 'Đăng ký nhận tin thành công!'); // Nếu dùng connect-flash
            // return res.redirect('back'); // Quay lại trang trước đó
            return res.status(200).send(`Đã nhận được email đăng ký: ${email}. Cảm ơn bạn đã đăng ký! (Đây là phản hồi mẫu, cần được hoàn thiện)`);

        } else {
            // req.flash('error_msg', 'Vui lòng nhập email.');
            // return res.redirect('back');
            return res.status(400).send('Vui lòng cung cấp địa chỉ email.');
        }
    } catch (err) {
        console.error('Lỗi xử lý đăng ký nhận tin:', err);
        // req.flash('error_msg', 'Có lỗi xảy ra, vui lòng thử lại.');
        // return res.redirect('back');
        next(err);
    }
};

// Trang wishlist
exports.getWishlistPage = async (req, res, next) => {
    try {
        if (!req.session.user) return res.redirect('/auth/login');
        const Product = require('../models/ProductModel');
        const user = await User.findById(req.session.user._id);
        const categories = await Category.find({});
        const wishlistNames = user.wishlist || [];
        let wishlistProducts = [];
        if (wishlistNames.length > 0) {
            // Lấy mỗi tên chỉ 1 sản phẩm đại diện (nếu có nhiều biến thể)
            const allProducts = await Product.find({ name: { $in: wishlistNames } });
            // Đảm bảo thứ tự theo wishlist
            wishlistProducts = wishlistNames.map(name => allProducts.find(p => p.name === name)).filter(Boolean);
        }
        const wishlistCount = user && user.wishlist ? user.wishlist.length : 0;
        const cartCount = user && user.carts ? user.carts.reduce((sum, item) => sum + (item.orderNumber || 0), 0) : 0;
        res.render('pages/wishlist', {
            title: 'Sản phẩm yêu thích',
            products: wishlistProducts,
            categories,
            wishlistCount,
            cartCount
        });
    } catch (err) {
        next(err);
    }
};