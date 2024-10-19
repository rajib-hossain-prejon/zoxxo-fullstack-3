// adminRouter.ts

// Import necessary modules and dependencies
import { Router, Response } from 'express';
import * as yup from 'yup'; // For input validation
import bcrypt from 'bcrypt'; // For password hashing
import User from '../../models/User'; // User model
import Invoice from '../../models/Invoice'; // Invoice model
import AdminLog from '../../models/AdminLog'; // Admin activity log model
import IRequest from '../../interfaces/IRequest'; // Custom request interface
import { BadRequestException, NotFoundExeption, resolveStatus } from '../../services/HttpException'; // Custom exceptions
import adminMiddleware from '../../services/adminMiddleware'; // Middleware to check admin privileges
import { sendEmailVerifcationMail } from '../../services/transport';
import Workspace from '../../models/Workspace';
import jwt from 'jsonwebtoken';
import Upload from '../../models/Upload';
import MonetizationModel from '../../models/Monetization';
const adminRouter = Router();

// Apply admin middleware to all routes in this router
// This ensures that only admin users can access these routes
adminRouter.use(adminMiddleware);

// Helper function to log admin activities
// This function creates a new entry in the AdminLog collection
const logAdminActivity = async (adminId: string, action: string, details: string) => {
  await AdminLog.create({ adminId, action, details });
};

// @desc Get all users (with pagination, search, and filters)
// @route GET /api/admin/users?page=1&limit=10&search=john&userType=Premium&userRole=Admin
// @access Admin
adminRouter.get('/users', async (req: IRequest, res: Response) => {
  try {
    // Parse query parameters for pagination and search
    const page = parseInt(req.query.page as string) || 1; // Current page number
    const limit = parseInt(req.query.limit as string) || 10; // Number of items per page
    const search = req.query.search as string; // Search term
    const userType = req.query.userType as string; // 'Premium' or 'Free'
    const userRole = req.query.userRole as string; // 'Admin' or 'User'

    // Start building the query
    let query: any = { isDeleted: { $ne: true } }; // Base query to exclude deleted users

    // Add search functionality if a search term is provided
    if (search) {
      query.$or = [
        { fullName: new RegExp(search, 'i') }, // Case-insensitive search on fullName
        { email: new RegExp(search, 'i') }, // Case-insensitive search on email
        { username: new RegExp(search, 'i') } // Case-insensitive search on username
      ];
    }

    // Add user type filter
    if (userType === 'Premium' || userType === 'Free') {
      query['subscription.subscriptionId'] = userType === 'Premium' ? { $exists: true } : { $exists: false };
    }

    // Add user role filter
    if (userRole === 'Admin' || userRole === 'User') {
      if (userRole === 'Admin') {
        query.$or = [{ isAdmin: true }, { isSuperAdmin: true }];
      } else {
        query.isAdmin = false;
        query.isSuperAdmin = false;
      }
    }

    // Fetch users from the database
    const users = await User.find(query)
      .select('-password') // Exclude password field
      .skip((page - 1) * limit) // Skip users on previous pages
      .limit(limit); // Limit the number of users returned

    // Count total number of users matching the query
    const total = await User.countDocuments(query);

    // Send response with users, total pages, and current page
    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalUsers: total
    });

  } catch (error: any) {
    // If an error occurs, send a 500 status with an error message
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});

// @desc Get all deleted users with search functionality
// @route GET /api/admin/users/deleted?page=1&limit=10&search=john
// @access Admin
adminRouter.get('/users/deleted', async (req: IRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;

    let query: any = { isDeleted: true };

    // Add search functionality if a search term is provided
    if (search) {
      query.$or = [
        { fullName: new RegExp(search, 'i') }, // Case-insensitive search on fullName
        { email: new RegExp(search, 'i') }, // Case-insensitive search on email
        { username: new RegExp(search, 'i') } // Case-insensitive search on username
      ];
    }

    const deletedUsers = await User.find(query)
      .select('-password')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.json({
      deletedUsers,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalDeletedUsers: total
    });
  } catch (error: any) {
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});



adminRouter.put('/users/update/:id', async (req: IRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;  

     
    const updatedUser = await User.findByIdAndUpdate(id, updates, { new: true, runValidators: true })
      .select('-password');  

    if (!updatedUser) {
      return res.status(404).json({ message: req.t('user-not-found') });
    }

    res.json({
      message: req.t('user-updated-successfully'),
      updatedUser,
    });
  } catch (error: any) {
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});



// @desc Soft delete user
// @route PUT /api/admin/users/:id/soft-delete
// @access Admin
adminRouter.put('/users/:id/soft-delete', async (req: IRequest, res: Response) => {
  try {
    // Find the user by ID and set isDeleted to true
    const user = await User.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: true });
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }
    // Log the soft delete action
    await logAdminActivity(req.user._id, 'SOFT_DELETE_USER', `Soft deleted user: ${user._id}`);
    res.json({ message: req.t('user-soft-deleted-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


adminRouter.put('/users/soft-delete', async (req: IRequest, res: Response) => {
  try {
    const { userIds } = req.body; // Expecting an array of user IDs from the request body

    // Check if userIds array exists and is not empty
    if (!userIds || userIds.length === 0) {
      throw new Error(req.t('user-ids-required')); // Handle error for missing user IDs
    }

    // Soft delete users by updating 'isDeleted' to true for each user in the userIds array
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isDeleted: true }
    );

    // Check if any users were updated
    if (result.modifiedCount === 0) {
      throw NotFoundExeption(req.t('users-not-found'));
    }

    // Log the soft delete action for multiple users
    await logAdminActivity(
      req.user._id,
      'SOFT_DELETE_USERS',
      `Soft deleted users: ${userIds.join(', ')}`
    );

    res.json({ message: req.t('users-soft-deleted-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


// @desc Restore deleted user
// @route PUT /api/admin/users/:id/restore
// @access Admin
adminRouter.put('/users/:id/restore', async (req: IRequest, res: Response) => {
  try {
    // Find the user by ID and set isDeleted to false
    const user = await User.findByIdAndUpdate(req.params.id, { isDeleted: false }, { new: true });
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }
   
    // Log the restore action
    await logAdminActivity(req.user._id, 'RESTORE_USER', `Restored user: ${user._id}`);
    res.json({ message: req.t('user-restored-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


adminRouter.put('/users/restore-user', async (req: IRequest, res: Response) => {
  try {
    const { userIds } = req.body; // Expecting an array of user IDs from the request body

    // Check if userIds array exists and is not empty
    if (!userIds || userIds.length === 0) {
      throw new Error(req.t('user-ids-required')); // Handle error for missing user IDs
    }

    // Restore users by updating 'isDeleted' to false for each user in the userIds array
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isDeleted: false }
    );

    // Check if any users were updated
    if (result.modifiedCount === 0) {
      throw NotFoundExeption(req.t('users-not-found'));
    }

    // Log the restore action for multiple users
    await logAdminActivity(
      req.user._id,
      'RESTORE_USERS',
      `Restored users: ${userIds.join(', ')}`
    );

    res.json({ message: req.t('users-restored-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});

// @desc Permanently delete user
// @route DELETE /api/admin/users/:id/permanent
// @access SuperAdmin
adminRouter.delete('/users/:id/permanent', async (req: IRequest, res: Response) => {
  try {
    // Check if the requesting user is a super admin
    if (!req.user.isSuperAdmin) {
      throw BadRequestException(req.t('only-super-admin-can-permanently-delete-users'));
    }
    // Permanently delete the user from the database
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }
    // Log the permanent delete action
    await logAdminActivity(req.user._id, 'PERMANENT_DELETE_USER', `Permanently deleted user: ${user._id}`);
    res.json({ message: req.t('user-permanently-deleted-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});

adminRouter.put('/users/permanent-delete', async (req: IRequest, res: Response) => {
  try {
    // Check if the requesting user is a super admin
    if (!req.user.isSuperAdmin) {
      throw BadRequestException(req.t('only-super-admin-can-permanently-delete-users'));
    }
  
    const { userIds } = req.body; // Expecting an array of user IDs from the request body
      console.log(userIds,req.body)
    // Check if userIds array exists and is not empty
    if (!userIds || userIds.length === 0) {
      throw new Error(req.t('user-ids-required')); // Handle error for missing user IDs
    }

    // Permanently delete users by their IDs
    const result = await User.deleteMany({ _id: { $in: userIds } });

    // Check if any users were deleted
    if (result.deletedCount === 0) {
      throw NotFoundExeption(req.t('users-not-found'));
    }

    // Log the permanent delete action for multiple users
    await logAdminActivity(
      req.user._id,
      'PERMANENT_DELETE_USERS',
      `Permanently deleted users: ${userIds.join(', ')}`
    );

    res.json({ message: req.t('users-permanently-deleted-successfully') });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


// @desc Get user by ID
// @route GET /api/admin/users/:id
// @access Admin
adminRouter.get('/users/:id', async (req: IRequest, res: Response) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }
    res.json(user);
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


// @desc Update user
// @route PUT /api/admin/users/:id
// @access Admin
adminRouter.put('/users/:id', async (req: IRequest, res: Response) => {
  const updateSchema = yup.object({
    fullName: yup.string().min(3),
    email: yup.string().email(),
    isAdmin: yup.boolean(),
    isSuperAdmin: yup.boolean(),
  });

  try {
    const data = await updateSchema.validate(req.body, { abortEarly: false });
    const user = await User.findByIdAndUpdate(req.params.id, data, { new: true }).select('-password');
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }
    
    // Log the update action
    await logAdminActivity(req.user._id, 'UPDATE_USER', `Updated user: ${user._id}`);

    res.json(user);
  } catch (error: any) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else if (error.name === 'MongoError' && error.code === 11000) {
      res.status(400).json({ message: req.t('email-already-exists') });
    } else {
      console.error('Error updating user:', error);
      res.status(resolveStatus(error)).json({ message: error.message });
    }
  }
});

// @desc Create new user
// @route POST /api/admin/users
// @access Admin
adminRouter.post('/users', async (req: IRequest, res: Response) => {
  const createUserSchema = yup.object({
    fullName: yup.string().min(3, req.t('name-or-company-too-short-enter-at-least-3-characters')).required(req.t('name-or-company-is-required')),
    username: yup.string().min(1, req.t('username-too-short-enter-at-least-1-character')).required(req.t('username-is-required')),
    email: yup.string().email(req.t('enter-a-valid-email')).required(req.t('email-is-required')),
    password: yup.string().min(8, req.t('password-too-short-enter-at-least-8-characters')).required(req.t('password-is-required')),
    isAdmin: yup.boolean().default(false),
    isSuperAdmin: yup.boolean().default(false),
  });

  try {
    const data = await createUserSchema.validate(req.body, { abortEarly: false });

    // Check if the creating admin is a super admin when trying to create an admin or super admin
    if ((data.isAdmin || data.isSuperAdmin) && !req.user.isSuperAdmin) {
      throw BadRequestException(req.t('only-super-admin-can-create-admin-users'));
    }

    // Check if username or email already exists
    const existingUser = await User.findOne({
      $or: [{ zoxxoUrl: data.username }, { username: data.username }, { email: data.email }]
    }).lean();

    if (existingUser) {
      throw BadRequestException(req.t('username-or-email-already-exists'));
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create default workspace
    const workspace = new Workspace({
      name: 'Default Workspace',
    });

    // Create user
    const newUser = await User.create({
      ...data,
      workspaces: [workspace._id],
      password: hashedPassword,
      defaultWorkspace: workspace._id,
      language: req.i18n.language,
      isEmailVerified: false, // Set to false as it's a new user
    });

    // Associate workspace with user
    await workspace.set('user', newUser._id).save();

    // Generate email verification token
    const token = jwt.sign({ email: newUser.email }, process.env.JWT_SECRET);
    // Send email verification
    await sendEmailVerifcationMail(
      {
        link: `${process.env.BACKEND_URL}/auth/email-verification?token=${token}`,
        to: newUser.email,
        fullName: newUser.fullName,
      },
      req.i18n.language,
    );

    await logAdminActivity(req.user._id, 'CREATE_USER', `Created new user: ${newUser._id}, isAdmin: ${newUser.isAdmin}, isSuperAdmin: ${newUser.isSuperAdmin}`);

    res.status(201).json({ 
      message: req.t('user-created-successfully'),
      user: { ...newUser.toObject(), password: undefined } 
    });

  } catch (error: any) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ message: error.errors.join(', ') });
    } else if (error.code === 11000) {
      res.status(400).json({ message: req.t('username-or-email-already-exists') });
    } else {
      res.status(resolveStatus(error)).json({ message: error.message });
    }
  }
});

// @desc Get subscriptions of a specific user
// @route GET /api/admin/users/:userId/subscriptions
// @access Admin
adminRouter.get('/users/:userId/subscriptions', async (req: IRequest, res: Response) => {
  try {
    const userId = req.params.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const user = await User.findById(userId);
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }

    const subscriptions = await User.findById(userId)
      .select('fullName email subscription')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (!subscriptions || !subscriptions.subscription) {
      return res.json({ message: req.t('no-subscriptions-found') });
    }

    const total = await User.countDocuments({ _id: userId, 'subscription.subscriptionId': { $exists: true } });

    res.json({
      subscriptions,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalSubscriptions: total
    });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});

// @desc Get invoices of a specific user
// @route GET /api/admin/users/:userId/invoices
// @access Admin
adminRouter.get('/users/:userId/invoices', async (req: IRequest, res: Response) => {
  try {
    const userId = req.params.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const user = await User.findById(userId);
    if (!user) {
      throw NotFoundExeption(req.t('user-not-found'));
    }

    const invoices = await Invoice.find({ user: userId })
      .populate('user', 'fullName email')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Invoice.countDocuments({ user: userId });

    if (total === 0) {
      return res.json({ message: req.t('no-invoices-found') });
    }

    res.json({
      invoices,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalInvoices: total
    });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});


// @desc Get all subscriptions
// @route GET /api/admin/subscriptions
// @access Admin
adminRouter.get('/subscriptions', async (req: IRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const subscriptions = await User.find({ 'subscription.subscriptionId': { $exists: true } })
      .select('fullName email subscription')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await User.countDocuments({ 'subscription.subscriptionId': { $exists: true } });

    res.json({
      subscriptions,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalSubscriptions: total
    });
  } catch (error: any) {
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});

// @desc Get all invoices
// @route GET /api/admin/invoices
// @access Admin
adminRouter.get('/invoices', async (req: IRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const invoices = await Invoice.find()
      .populate('user', 'fullName email')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Invoice.countDocuments();

    res.json({
      invoices,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalInvoices: total
    });
  } catch (error: any) {
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});



// @desc Get admin activity logs
// @route GET /api/admin/logs
// @access SuperAdmin
adminRouter.get('/logs', async (req: IRequest, res: Response) => {
  try {
    if (!req.user.isSuperAdmin) {
      throw BadRequestException(req.t('only-super-admin-can-view-logs'));
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const logs = await AdminLog.find()
      .sort('-createdAt')
      .populate('adminId', 'fullName email')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await AdminLog.countDocuments();

    res.json({
      logs,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalLogs: total
    });
  } catch (error: any) {
    res.status(resolveStatus(error)).json({ message: error.message });
  }
});

// @desc Get system statistics
// @route GET /api/admin/stats
// @access Admin
adminRouter.get('/stats', async (req: IRequest, res: Response) => {
  try {
    // Count total active users
    const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
    // Count total deleted users
    const totalDeletedUsers = await User.countDocuments({ isDeleted: true });
    // Count total users with active subscriptions
    const totalSubscriptions = await User.countDocuments({ 'subscription.subscriptionId': { $exists: true } });
    // Count total invoices
    const totalInvoices = await Invoice.countDocuments();

    // Send response with all statistics
    res.json({
      totalUsers,
      totalDeletedUsers,
      totalSubscriptions,
      totalInvoices
    });
  } catch (error: any) {
    res.status(500).json({ message: req.t('internal-server-error') });
  }
});


adminRouter.get('/workspaces/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;

     const user = await User.findById(userId).populate('workspaces');  
    
    if (!user || !user.workspaces || user.workspaces.length === 0) {
      return res.status(404).json({ message: "No workspaces found for the user" });
    }

     const workspaceIds = user.workspaces.map(workspace => workspace._id);

     const uploads = await Upload.find({ workspace: { $in: workspaceIds } });  
    
     const monitizedDirector=await MonetizationModel.find({ownerId:userId}).populate([

      {path:'uploadId'}
      ]);
    if (!uploads || uploads.length === 0) {
      return res.status(404).json({ message: "No uploads found in the workspaces" });
    }

   
    res.json({ uploads,monitizedDirector });

  } catch (error) {
    console.error("Error fetching user uploads: ", error);
    res.status(500).json({ message: "Server error", error });
  }
});


adminRouter.put('/upload/delete/:id', async (req, res) => {
  try {
    const uploadId = req.params.id;

     const upload = await Upload.findById(uploadId);
    if (!upload) {
      return res.status(404).json({ message: "Upload not found" });
    }
     const workspace = await Workspace.findById(upload.workspace);

     await Upload.findByIdAndDelete(uploadId);

     if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const Uploads = workspace.uploads.filter(id => id.toString() !== uploadId);
     workspace.uploads = Uploads;
     workspace.user =upload.user ;
     await workspace.save();

     await MonetizationModel.updateMany(
      { uploadId },
      { $pull: { uploadId } }
    );

    res.status(200).json({ message: "Upload deleted and removed from workspace successfully" });
  } catch (error) {
    console.error("Error deleting upload: ", error);
    res.status(500).json({ message: "Server error", error });
  }
});


export default adminRouter;