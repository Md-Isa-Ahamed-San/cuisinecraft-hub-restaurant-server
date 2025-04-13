const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const axios = require("axios");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://cuisinecraft-hub-restaurant.web.app",
      "https://cuisinecraft-hub-restaurant.firebaseapp.com/",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        connectSrc: ["'self'", "https://group-study-assignment-a7832.web.app"],
      },
    },
  })
);
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jeu0kz0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();
    const cuisineCraftHub = await client.db("cuisineCraftHub");
    const menu_collection = cuisineCraftHub.collection("menu");
    const review_collection = cuisineCraftHub.collection("review");
    const chef_recommendation_collection =
      cuisineCraftHub.collection("chefRecommend");
    const cart_data = cuisineCraftHub.collection("cart");
    const userCollection = cuisineCraftHub.collection("user");
    const contactUsCollection = cuisineCraftHub.collection("contactUs");
    const paymentsCollection = cuisineCraftHub.collection("payments");
    const reservationCollection = cuisineCraftHub.collection("reservation");

    //middleware
    const verifyToken = async (req, res, next) => {
      console.log("Request URL:", req.originalUrl);
      // console.log("inside verify token. req.headers is: ", req.headers);

      if (!req.headers.authorization) {
        res
          .status(401)
          .send({ message: "Forbidden access.Authorization not found" });
      }
      const accessToken = await req.headers.authorization.split(" ")[1];
      // console.log("accesstoken:", accessToken);
      jwt.verify(
        accessToken,
        process.env.ACCESS_TOKEN_SECRET,
        (error, decoded) => {
          if (error) {
            console.log("error in verify token", error);
            return res
              .status(401)
              .send({ message: "error while verifying token " });
          } else if (decoded) {
            req.decoded = decoded;
            console.log("decoded", decoded);
          }
        }
      );

      next();
    };
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;

      const query = {
        email: email,
        role: "admin",
      };
      const user = await userCollection.findOne(query);
      // console.log(user)

      // if i use this then the dashboard's useAdmin calls continuously. vvi
      // if (!user) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      next();
    };

    app.get("/menu", async (req, res) => {
      const response = menu_collection.find();
      const result = await response.toArray();
      res.send(result);
    });
    app.get("/review", async (req, res) => {
      const response = review_collection.find();
      const result = await response.toArray();
      res.send(result);
    });
    app.get("/chef_recommendation", async (req, res) => {
      const response = chef_recommendation_collection.find();
      const result = await response.toArray();
      // console.log(result)
      res.send(result);
    });
    app.get("/cartList", async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const dataFromDb = await cart_data.find(query).toArray();
      res.send(dataFromDb);
    });
    //cartList finished
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      if (req.admin === false) {
        // console.log("false");
        res.status(401).send({ message: "unauthorized access" });
      } else {
        // console.log("true");
        const result = await userCollection.find().toArray();
        res.send(result);
      }
    });
    app.get(
      "/user/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req.decoded?.email) {
          res.status(403).send({ message: "forbidden access" });
        }
        const query = { email: email };
        const user = await userCollection.findOne(query);
        let admin = false;
        if (user) {
          admin = user?.role === "admin";
        }
        res.send({ admin });
      }
    );
    app.get("/contactUs", async (req, res) => {
      const result = await contactUsCollection.find().toArray();
      console.log(result);
      res.send(result);
    });

    app.get("/admin-stats", async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menu_collection.estimatedDocumentCount();
      const orders = await paymentsCollection.estimatedDocumentCount();
      const revenueResult = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$price" },
            },
          },
        ])
        .toArray();
      console.log("revenue Result: ", revenueResult);
      const revenue =
        revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
      res.send({
        users,
        menuItems,
        orders,
        revenue,
      });
    });

    app.get("/sold-stats", async (req, res) => {
      try {
        const soldStats = await paymentsCollection
          .aggregate([
            {
              $unwind: "$menuItemId",
            },
            {
              $lookup: {
                from: "menu",
                let: { menuItemId: { $toObjectId: "$menuItemId" } },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$_id", "$$menuItemId"] },
                    },
                  },
                ],
                as: "menuItems",
              },
            },
            {
              $unwind: "$menuItems",
            },
            {
              $group: {
                _id: "$menuItems.category",
                quantity: { $sum: 1 },
                revenue: { $sum: "$menuItems.price" },
              },
            },
          ])
          .toArray();

        console.log(soldStats);
        res.send(soldStats);
      } catch (error) {
        console.error("Error fetching sold stats:", error);
        res.status(500).send("Error fetching sold stats");
      }
    });
    app.get("/userPaymentHistory", async (req, res) => {
      const email = req.query.email;
      console.log("user payment", email);
      const query = { email: email };
      try {
        const soldStats = await paymentsCollection
          .aggregate([
            {
              $match: {
                email: email,
              },
            },
            {
              $unwind: "$menuItemId",
            },
            {
              $lookup: {
                from: "menu",
                let: { menuItemId: { $toObjectId: "$menuItemId" } },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$_id", "$$menuItemId"] },
                    },
                  },
                ],
                as: "menuItems",
              },
            },
            {
              $unwind: "$menuItems",
            },
            {
              $group: {
                _id: "$menuItems.category",
                quantity: { $sum: 1 },
                revenue: { $sum: "$menuItems.price" },
              },
            },
          ])
          .toArray();

        console.log(soldStats);
        res.send(soldStats);
      } catch (error) {
        console.error("Error fetching sold stats:", error);
        res.status(500).send("Error fetching sold stats");
      }
    });
    app.get("/paymentHistory/:id", async (req, res) => {
      const email = req.params.id;
      console.log("email is payment history", email);
      const query = { email: email };
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/allBookings", async (req, res) => {
      const result = await reservationCollection.find().toArray();
      // console.log("all booking result",result)
      res.send(result);
    });
    app.get("/myBookings", async (req, res) => {
      try {
        const email = req.query.email;
        console.log("mybooking email", email);
        const query = {
          "reservationData.userEmail": email,
        };
        const response = await reservationCollection.find(query).toArray();
        console.log(response);
        res.send(response);
      } catch (error) {
        console.error("Error fetching my bookings:", error);
        res.status(500).send("Internal server error");
      }
    });

    app.get("/paymentHistoryPurchaseDetails", async (req, res) => {
      const items = req.query.items;
      // console.log(items);
      const itemList = items.split(",");
      const objectIdArray = itemList.map(id => new ObjectId(id.trim()));

      // console.log(item)
      const response = await menu_collection
        .find({
          _id: {
            $in: objectIdArray,
          },
        })
        .toArray();
      // console.log(response)
      res.send(response);
    });

    app.post("/verifyRecaptcha", async (req, res) => {
      const { recaptchaValue } = req.body;
      console.log(req.body);
      try {
        const response = await axios.post(
          "https://www.google.com/recaptcha/api/siteverify?secret=6Lfv_lgpAAAAAGL__eKMi8YiOg4Dv5klSx_Xt1J7&response=" +
            recaptchaValue
        );

        // Check response.success and take appropriate action
        if (response.data.success) {
          // reCAPTCHA verification successful
          console.log("success recaptcha");
          res.status(200).json({ success: true });
        } else {
          // reCAPTCHA verification failed
          console.log("failed recaptcha", response);
          res
            .status(400)
            .json({ success: false, error: "reCAPTCHA verification failed" });
        }
      } catch (error) {
        console.error("Error verifying reCAPTCHA:", error);
        res
          .status(500)
          .json({ success: false, error: "Internal server error" });
      }
    });
    //verify recaptcha finished
    app.post("/addToCart", async (req, res) => {
      console.log("data in post.addToCart: ", req.body);
      const cartItem = req.body;
      const dataFromDb = await cart_data.insertOne(cartItem);
      res.send("data inserted successfully");
    });
    app.post("/users", async (req, res) => {
      const { email, username } = req.body;
      const userData = {
        email,
        username,
      };

      console.log("userdata at /users is ", userData);
      try {
        const query = { email: email };
        const userAlreadyExists = await userCollection.findOne(query);
        if (!userAlreadyExists) {
          console.log("Updating user details:", email, username);

          const result = await userCollection.insertOne(userData);
          if (result.insertedCount === 1) {
            res.status(201).send("User details inserted successfully.");
          } else {
            res.status(200).send("Error while inserting user");
          }
        }
        res.status(200).send("User exists already.");
      } catch (error) {
        console.error("Error occurred:", error);
        res.status(500).send("An error occurred while updating user details.");
      }
    });
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      jwt.sign(
        user,
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1hr",
        },
        (err, token) => {
          if (err) {
            res.status(500).send({ message: "error while creating token" });
          } else if (token) {
            res.status(200).send({ token });
          }
        }
      );
    });
    app.post("/addItem", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      console.log(data);
      const result = await menu_collection.insertOne(data);
      res.send(result);
    });
    app.post("/create-payment-intent", async (req, res) => {
      // const { items } = req.body;
      const { price } = req.body;
      const amount = parseInt(price) * 100; //converts into cents
      console.log("amount is ", amount);
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        //here we cant set payment method type and automatic payment method at the same time;
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      // console.log(payment);
      const paymentResult = await paymentsCollection.insertOne(payment);
      const query = {
        email: payment.email,
      };
      // console.log(query)
      const deleteRes = await cart_data.deleteMany(query);
      res.send({ paymentResult, deleteRes });
    });
    app.post("/reservation", async (req, res) => {
      const data = req.body;
      console.log("🚀 ~ app.post ~ reservation:", data);
      try {
        const response = await reservationCollection.insertOne(data);
        if (response.insertedId) {
          res.status(200).send(response); // Sending the entire response object might not be ideal
        } else {
          res.status(403).send({ message: "couldn't reserve" });
        }
      } catch (error) {
        console.error("Error occurred while making reservation:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.patch("/confirmReservation", async (req, res) => {
      try {
        const id = req.body.itemId;
        // console.log("🚀 ~ app.post ~ id:", id);
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            "reservationData.status": "confirmed",
          },
        };
        const response = await reservationCollection.updateOne(
          filter,
          updateDoc
        );
        console.log(response);
        if (response.modifiedCount === 1) {
          res.status(200).send(response);
        } else {
          res.status(403).send(response);
        }
      } catch (err) {
        res.status(500).send(response);
      }
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      console.log("🚀 ~ app.patch ~ id:", id);

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const response = await userCollection.updateOne(filter, updateDoc);
      res.send(response);
    });

    app.patch("/updateItem/:id", async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      console.log("🚀 ~ app.patch ~ data:", data);
      // console.log("🚀 ~ app.patch ~ id:", id)
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: data.name,
          recipe: data.recipe,
          image: data.image,
          category: data.category,
          price: data.price,
        },
      };
      // console.log("🚀 ~ app.patch ~ filter:", filter)
      const result = await menu_collection.updateOne(filter, updateDoc);
      res.send(result);
    });
    app.delete("/deleteCartItem/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const response = await cart_data.deleteOne(query);
      // console.log("response deleted successfully.", response);
      res.send(response);
    });

    app.delete("/deleteUser/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const response = await userCollection.deleteOne(query);
      res.send(response);
    });
    app.delete(
      "/deleteItem/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        console.log("id in item delete ", id);
        const query = { _id: new ObjectId(id) };
        const result = menu_collection.deleteOne(query);
        res.send(result);
      }
    );
    app.delete("/deleteReservation", async (req, res) => {
      try {
        const id = req.query._id;
        console.log("delete id in /deleteReservation: ", id);
        const query = { _id: new ObjectId(id) };
        const response = await reservationCollection.deleteOne(query);
        console.log("res in delete reservation:", response);
        if (response.deletedCount > 0) {
          res.status(200).send(response);
        } else {
          res.status(405).send({ message: "internal server error" });
        }
      } catch (err) {
        res.status(405).send({ message: "internal server error" });
      }
    });

    //add to cart finished
  } catch (err) {
    console.log("error is run function of index.js : ", err);
  }
}

run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("server is running!!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
