import { Webhook } from "svix";
import userModel from "../models/userModel.js";
import razorpay from 'razorpay';
import transactionModel from "../models/transactionModel.js";
import connectDB from "../configs/mongodb.js";

const razorpayInstance = new razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const processedWebhooks = new Map();

const clerkWebhooks = async (req, res) => {
  res.status(202).json({ received: true });
  
  try {
    const requiredHeaders = ['svix-id', 'svix-signature', 'svix-timestamp'];
    for (const header of requiredHeaders) {
      if (!req.headers[header]) {
        console.error(`Missing required header: ${header}`);
        return;
      }
    }

    const whook = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
    await whook.verify(JSON.stringify(req.body), {
      "svix-id": req.headers["svix-id"],
      "svix-signature": req.headers["svix-signature"],
      "svix-timestamp": req.headers["svix-timestamp"]
    });

    const { data, type } = req.body;
    const webhookId = req.headers["svix-id"];

    if (processedWebhooks.has(webhookId)) {
      console.log(`Webhook ${webhookId} already processed, skipping`);
      return;
    }

    processedWebhooks.set(webhookId, { status: 'processing', timestamp: Date.now() });
    
    const oneHourAgo = Date.now() - 3600000;
    for (const [id, details] of processedWebhooks.entries()) {
      if (details.timestamp < oneHourAgo) {
        processedWebhooks.delete(id);
      }
    }

    let dbConnected = false;
    let retries = 0;
    
    while (!dbConnected && retries < 3) {
      try {
        await connectDB();
        dbConnected = true;
      } catch (error) {
        retries++;
        console.warn(`DB connection attempt ${retries} failed, retrying...`);
        if (retries >= 3) {
          throw new Error('Failed to connect to database after 3 attempts');
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }

    let email = null;
    if (data && data.email_addresses && Array.isArray(data.email_addresses) && data.email_addresses.length > 0) {
      if (data.primary_email_address_id) {
        const primaryEmail = data.email_addresses.find(email => email.id === data.primary_email_address_id);
        email = primaryEmail ? primaryEmail.email_address : data.email_addresses[0].email_address;
      } else {
        email = data.email_addresses[0].email_address;
      }
    }

    console.log('Processing webhook:', { type, clerkId: data.id, email });

    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();
      
      switch (type) {
        case "user.created": {
          let existingUser;
          let creationAttempts = 0;
          let created = false;
          
          while (!created && creationAttempts < 3) {
            existingUser = await userModel.findOne({ clerkId: data.id }).session(session);
            
            if (existingUser) {
              if (existingUser.webhookProcessed && existingUser.webhookProcessed.get(webhookId)) {
                console.log('Webhook already processed for this user');
                break;
              }
              
              await userModel.findOneAndUpdate(
                { clerkId: data.id },
                { $set: { [`webhookProcessed.${webhookId}`]: 'processed' } },
                { session }
              );
              break;
            }
            
            try {
              const userData = {
                clerkId: data.id,
                email: email,
                photo: data.image_url || null, 
                firstName: data.first_name,
                lastName: data.last_name,
                webhookProcessed: { [webhookId]: 'processed' }
              };
              
              await userModel.create([userData], { session });
              created = true;
            } catch (error) {
              if (error.code === 11000) {
                creationAttempts++;
                console.warn(`Race condition detected on user creation, attempt ${creationAttempts}`);
                if (creationAttempts >= 3) {
                  throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 100 * creationAttempts));
              } else {
                throw error;
              }
            }
          }
          break;
        }

        case "user.updated": {
          const userData = {
            email: email,
            photo: data.image_url || null,
            firstName: data.first_name,
            lastName: data.last_name,
            [`webhookProcessed.${webhookId}`]: 'processed'
          };

          Object.keys(userData).forEach(key => {
            if (userData[key] === null || userData[key] === undefined) {
              delete userData[key];
            }
          });

          await userModel.findOneAndUpdate(
            { clerkId: data.id },
            { $set: userData },
            { session, upsert: false } 
          );
          break;
        }

        case "user.deleted": {
          await userModel.findOneAndDelete({ clerkId: data.id }, { session });
          break;
        }

        default:
          console.log(`Unhandled webhook type: ${type}`);
      }
      
      await session.commitTransaction();
      processedWebhooks.set(webhookId, { status: 'completed', timestamp: Date.now() });
      console.log(`Webhook ${webhookId} processed successfully`);
    } catch (error) {
      await session.abortTransaction();
      processedWebhooks.set(webhookId, { status: 'failed', timestamp: Date.now(), error: error.message });
      console.error('Webhook processing failed:', error.message);
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
  }
};

const userCredits = async (req, res) => {
  try {
    await connectDBWithRetry();
    
    const { clerkId } = req.user;
    const userData = await userModel.findOne({ clerkId });

    if (!userData) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, credits: userData.creditBalance });
  } catch (error) {
    console.error('Error in userCredits:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function connectDBWithRetry(maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await connectDB();
      return;
    } catch (error) {
      retries++;
      console.warn(`DB connection attempt ${retries} failed, retrying...`);
      if (retries >= maxRetries) {
        throw new Error('Failed to connect to database after multiple attempts');
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * retries));
    }
  }
}

const paymentRazorpay = async (req, res) => {
    try {
        const { clerkId } = req.user
        const { planId } = req.body

        const userData = await userModel.findOne({ clerkId })

        if (!userData || !planId) {
            res.json({ success: false, message: 'Invalid credentials' });
        }

        let credits, plan, amount, date

        switch (planId) {
            case 'Basic':
                plan = 'Basic'
                credits = 100
                amount = 10
                break;
            case 'Advanced':
                plan = 'Advanced'
                credits = 500
                amount = 50
                break;
            case 'Business':
                plan = 'Business'
                credits = 5000
                amount = 250
                break;
            default:
                break;
        }

        date = Date.now()

        const transactionData = {
            clerkId,
            plan,
            amount,
            credits,
            date
        }

        const newTransaction = await transactionModel.create(transactionData)
        const options = {
            amount: amount * 100,
            currency: process.env.CURRENCY,
            receipt: newTransaction._id
        }

        await razorpayInstance.orders.create(options, (error, order) => {
            if (error) {
                return res.json({ success: false, message: error })
            }
            res.json({ success: true, order })
        })
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

const verifyRazorpay = async (req, res) => {
    try {
        const { razorpay_order_id } = req.body
        const orderinfo = await razorpayInstance.orders.fetch(razorpay_order_id)

        if (orderinfo.status === 'paid') {
            const transactionData = await transactionModel.findById(orderinfo.receipt)
            if (transactionData.payment) {
                return res.json({ success: false, message: 'Payment Failed' })
            }

            const userData = await userModel.findOne({ clerkId: transactionData.clerkId })
            const creditBalance = userData.creditBalance + transactionData.credits
            await userModel.findByIdAndUpdate(userData._id, { creditBalance })

            await transactionModel.findByIdAndUpdate(transactionData._id, { payment: true })
            res.json({ success: true, message: 'Credits Added' })
        }
    } catch (error) {
        console.log(error.message);
        res.json({ success: false, message: error.message });
    }
}

export { clerkWebhooks, userCredits, paymentRazorpay, verifyRazorpay }