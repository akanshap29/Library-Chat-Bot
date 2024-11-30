// Import necessary modules
import express from 'express';
import mongoose from 'mongoose';
import Razorpay from 'razorpay';
import axios from 'axios';
import cron from 'node-cron';

// Initialize the Express app
const app = express();
app.use(express.json());

// Razorpay instance
const razorpayInstance = new Razorpay({
  key_id: 'rzp_test_CvX3S6f89c1XT4', // Replace with your Razorpay Test Key ID
  key_secret: '3SYq6akPHX4LYlsdtv1MzWpB', // Replace with your Razorpay Test Key Secret
});

// MongoDB connection
mongoose
  .connect('mongodb://localhost:27017/libraryDB')
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Define the schema for library dues
const dueSchema = new mongoose.Schema({
  userId: String,
  userName: String,
  phoneNumber: String,
  amount: Number,
  dueDate: Date,
  paid: { type: Boolean, default: false },
  paymentLink: String,
});

const Due = mongoose.model('Due', dueSchema);

// Store Access Token in memory
let ACCESS_TOKEN = 'EAAcA2JI9PkkBOyXUvch7TIvCcgNJgD3DaZCyVlApViEEVjVS2HTb9L9dqJvqZAOfOxqofVdntHrz4ZCoGBiOHsmfs9PLXOqriSAdyVT08iwDW1SbJZAMRyYOughj3CUko4n7euPoNrdI1uLAmvaHZAZAJCIcOKVc4Yt8vFlymgKZCrIbCM28yjrlIsnbrc9s8m78dAZCZB16NZCUymRDCJVpYT0sYCTxIZD'; // Replace with your initial token

// Utility function to refresh token
const refreshAccessToken = async () => {
  console.log('Refreshing Access Token...');
  try {
    // Call your method or service to refresh the token (if applicable)
    // Replace the below line with an actual API call if your setup supports token renewal
    const newToken = 'NEW_ACCESS_TOKEN_FROM_META'; // Replace this with the refreshed token
    ACCESS_TOKEN = newToken;
    console.log('Access Token refreshed successfully:', ACCESS_TOKEN);
  } catch (error) {
    console.error('Failed to refresh Access Token:', error.message || error);
  }
};

// Function to send WhatsApp message
const sendWhatsAppMessage = async (phoneNumber, userName, amount, dueDate, paymentLink) => {
  const messagePayload = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    type: 'template',
    template: {
      name: 'due_payment_reminder', // Template name
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: userName },
            { type: 'text', text: `₹${amount}` },
            { type: 'text', text: new Date(dueDate).toLocaleDateString() },
            { type: 'text', text: `https://rzp.io/i/${paymentLink}` },
          ],
        },
      ],
    },
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v16.0/441858239011987/messages`, // Replace with your Phone Number ID
      messagePayload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('WhatsApp message sent successfully:', response.data);
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('Access Token expired. Refreshing token...');
      await refreshAccessToken();
      throw new Error('Access Token expired. Retry sending message.');
    } else {
      console.error('Failed to send WhatsApp message:', error.response?.data || error.message);
      throw new Error('WhatsApp message failed to send');
    }
  }
};

// Route to add a new due
app.post('/api/addDue', async (req, res) => {
  try {
    const { userId, userName, phoneNumber, amount, dueDate } = req.body;

    if (!userId || !userName || !phoneNumber || !amount || !dueDate) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    console.log('Step 1: Validating input - Passed');

    const orderOptions = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1,
    };

    const razorpayOrder = await razorpayInstance.orders.create(orderOptions);
    console.log('Step 2: Razorpay order created:', razorpayOrder);

    const newDue = new Due({
      userId,
      userName,
      phoneNumber,
      amount,
      dueDate,
      paymentLink: razorpayOrder.id,
    });

    await newDue.save();
    console.log('Step 3: Due saved to database:', newDue);

    try {
      await sendWhatsAppMessage(phoneNumber, userName, amount, dueDate, razorpayOrder.id);
      console.log('Step 4: WhatsApp message sent.');
    } catch (messageError) {
      console.error('Failed to send WhatsApp message:', messageError.message);
      return res.status(500).json({
        error: 'Due added but failed to send WhatsApp message',
        details: messageError.message,
      });
    }

    res.status(201).json({
      message: 'Due added successfully, WhatsApp message sent.',
      due: newDue,
      razorpayOrder,
    });
  } catch (error) {
    console.error('Error in /api/addDue:', error.message || error);
    res.status(500).json({ error: 'Failed to add due and send WhatsApp message' });
  }
});

// Start server
app.listen(5000, () => {
  console.log('Server running on port 5000');
});
