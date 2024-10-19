import { Variables } from "../utils/variables";
import { Router, Request, Response } from "express";
import * as yup from "yup";
import crypto from "crypto";
import archiver from "archiver";
import jwt from "jsonwebtoken";
import * as nodeScheduler from "node-schedule";
import { scheduleJob } from "node-schedule";
import mongoose from "mongoose";

import storage, {
  // getFileDownloadSignedURL,
  getFileUploadSignedURL,
} from "../services/google-cloud-storage";
import Upload from "../models/Upload";
import {
  BadRequestException,
  NotFoundExeption,
  resolveStatus,
} from "../services/HttpException";
import {
  sendEmailToUploader,
  sendNewUploadMail,
  sendPublicEmail,
} from "../services/transport";
import IUser from "../interfaces/IUser";
import User from "../models/User";
import Workspace from "../models/Workspace";
import IWorkspace from "../interfaces/IWorkspace";
import { IUpload } from "../interfaces/IUpload";
import { IData, zipFiles } from "../services/google-cloud-run";
import authToken from "../services/authToken";

// handle auto deletion of invalid or expired uploads
// and canceled subscriptions
const deleteUploadsAutomatically = async () => {
  try {
    // get all uploads that are invalid and older than 24 hours
    const today = new Date();
    const twentyFourHoursAgo = new Date(today.setHours(today.getHours() - 24));
    const uploads = await Upload.find({
      user: null, // uploaded by free users
      createdAt: { $lt: twentyFourHoursAgo },
    })
      .select("user createdAt _id")
      .lean();
    // delete upload
    uploads.forEach((up) => deleteUpload(up._id.toString()));
    if (uploads.length > 0)
      console.log("delete uploads initiated", uploads.length);
  } catch (e: any) {
    console.log(
      "Error while auto deletion and cancelation",
      JSON.stringify(e, null, 2)
    );
  }
};
scheduleJob(
  "delete expired uploads",
  "* * * * *",
  () => deleteUploadsAutomatically() // delete after every minute
);

const TWO_GB_LIMIT = 2 * 1000 * 1000 * 1000;
const FOUR_GB_LIMIT = 4 * 1000 * 1000 * 1000;

// Uploads map for deletion jobs
const uploadsMap: Record<string, nodeScheduler.Job | null> = {};

const deleteUpload = async (id: string) => {
  const upload = await Upload.findById(id.toString())
    .select("_id user files zipLocation bucket workspace")
    .populate({
      path: "user",
      select: {
        _id: 1,
      },
    })
    .populate({
      path: "workspace",
      select: {
        _id: 1,
      },
    })
    .lean();
  console.log("deleting upload " + JSON.stringify(upload));
  upload.files.forEach(async (f) => {
    if (!f.filename) return;
    const file = storage.bucket(upload.bucket).file(f.filename);
    if (!(await file.exists())) return;
    file.delete().catch((e) => console.log(e.message, e.stackTrace));
  });
  if (upload.zipLocation) {
    // check whether upload is public
    if (upload.user) {
      await storage
        .bucket(upload.bucket)
        .file(
          `${upload.user._id.toString()}/${upload.workspace._id.toString()}/${upload._id.toString()}.zip`
        )
        .delete()
        .catch((e) => console.log(e.message, e.stackTrace));
    } else {
      await storage
        .bucket(upload.bucket)
        .file(`uploads/${upload._id.toString()}.zip`)
        .delete()
        .catch((e) => console.log(e.message, e.stackTrace));
    }
  }
  if (upload.user) {
    await User.findByIdAndUpdate(upload.user._id, {
      $pull: {
        uploads: upload._id,
      },
    });
  }
  if (upload.workspace) {
    await Workspace.findByIdAndUpdate(upload.workspace._id, {
      $pull: {
        uploads: upload._id,
      },
    });
  }
  await Upload.deleteOne(upload._id);
};

const uploadsRouter = Router();

uploadsRouter.post("/", async (req: Request, res: Response) => {
  const schema = yup.object({
    files: yup
      .array()
      .of(
        yup.object({
          name: yup
            .string()
            .min(3, req.t("filename-should-have-at-least-3-characters"))
            .required(req.t("filename-is-required")),
          size: yup
            .number()
            .integer(req.t("invalid-size-value-contains-decimals"))
            .min(1, req.t("size-too-small"))
            .required(req.t("size-is-required")),
        })
      )
      .required(req.t("files-are-required")),
  });
  try {
    const { files } = schema.validateSync(req.body, {
      stripUnknown: true,
      abortEarly: true,
    });
    // check whether user is logged in
    let user: IUser | undefined;
    const token = authToken(req);
    if (token) {
      try {
        const { _id } = jwt.verify(token, process.env.JWT_SECRET || "") as {
          _id: string;
        };
        user = await User.findById(_id).populate({
          path: "workspaces",
          populate: {
            path: "uploads",
            match: { isValid: true },
          },
        });
      } catch (e) {
        console.log(e.message, e.stackTrace);
      }
    }
    // calculate files total size
    const totalSize = files.reduce((sum = 0, f) => f.size + sum, 0);
    // public users can only upload to max of 2GB
    if (!user && totalSize > TWO_GB_LIMIT)
      throw BadRequestException(req.t("can-not-upload-files-more-than-2GB"));
    else if (user) {
      // limit totalSize according to user's registeration plan
      const allUploads = user.workspaces.reduce<IUpload[]>(
        (acc = [], curr) => [...acc, ...curr.uploads],
        []
      );
      const totalSizeConsumed = allUploads.reduce(
        (sum = 0, curr) => sum + curr.sizeInBytes,
        0
      );
      // free registered users can only upload up to 2GB and store 4GB at max
      if (!user?.subscription?.type) {
        if (totalSize > TWO_GB_LIMIT)
          throw BadRequestException(
            req.t("can-not-upload-files-more-than-2GB")
          );
        else if (totalSize + totalSizeConsumed > FOUR_GB_LIMIT)
          throw BadRequestException(req.t("your-storage-is-not-enough"));
      }
      // tornado users can only uplod to max of their storage size
      else if (totalSize + totalSizeConsumed > user.storageSizeInBytes)
        throw BadRequestException(req.t("your-storage-is-not-enough"));
    }
    // calculate remaining upload size for registered user
    if (user) {
      const allUploads = (user.workspaces as IWorkspace[]).reduce(
        (acc = [], curr) => [...acc, ...(curr.uploads as IUpload[])],
        [] as IUpload[]
      );
      const totalSizeConsumed = allUploads.reduce(
        (sum = 0, curr) => sum + curr.sizeInBytes,
        0
      );
      // registered users can only uplod to max of their storage
      if (totalSize + totalSizeConsumed > user.storageSizeInBytes)
        throw BadRequestException(req.t("your-storage-is-not-enough"));
    }
    const bucket = user ? Variables.uploadsBucket : Variables.publicBucket;
    // create upload id
    const uid = new mongoose.Types.ObjectId();
    // generate upload links
    const links = await Promise.all(
      files.map((f) =>
        getFileUploadSignedURL(
          f.name,
          f.size,
          bucket,
          `${
            user
              ? user._id.toString() + "/" + user.workspaces[0]._id.toString()
              : "uploads"
          }/${uid.toString()}`
        )
      )
    );
    // create upload record in the database
    const upload = await Upload.create({
      _id: uid,
      user: user?._id,
      workspace: user?.workspaces[0]._id,
      name: crypto.randomUUID().slice(0, 18), // random name for public upload
      files: files.map((f, idx) => ({
        filename: links[idx].newFilename,
        size: f.size,
      })),
      bucket: bucket,
      sizeInBytes: totalSize,
    });
    // add upload to default workspace for logged in user
    if (user)
      await Workspace.findByIdAndUpdate(user.workspaces[0], {
        $push: {
          uploads: upload.id,
        },
      });
    // setting cors configuration so that upload can begin on frontend
    await storage.bucket(bucket).setCorsConfiguration([
      {
        maxAgeSeconds: 60 * 60, // 1 hr
        method: ["POST", "PUT", "OPTIONS"],
        origin: [
          "http://localhost:8000",
          "http://localhost:9000",
          "https://www.zoxxo.io",
          "https://zoxxo.io",

          // zedfoundation configuration
          "https://zoxxo-dev.ey.r.appspot.com", //app engine ->services->default(url)
          // "https://dev.zoxxo.io", //custom domain for website
          "https://zedfoundation.de", //custom domain for website
          "https://fdownload.zoxxo.io", //cloud run domain mapping
          "https://fzip.zoxxo.io", // cloud run domain mapping

          // dev.zoxxo.io configuration
          "https://dev.zoxxo.io", //app engine ->services->default(url)
          "https://zoxxo-developer-434914.ey.r.appspot.com/", //custom domain for website
          "https://devdownload.zoxxo.io", //cloud run domain mapping
          "https://devzip.zoxxo.io", // cloud run domain mapping
        ],
        responseHeader: ["Content-Type"],
      },
    ]);
    // generate email token to be used for verifying `send email request`
    // after successful upload on fronted
    const emailToken = jwt.sign(
      { uploadId: upload._id.toString() },
      process.env.JWT_SECRET,
      {
        expiresIn: 2 * 60 * 60, // 2 hours
      }
    );
    res.json({ uploadUrls: links.map((lnk) => lnk.url), upload, emailToken });
    // schedule the deletion for public user
    if (!user) {
      const job = nodeScheduler.scheduleJob(
        new Date(Date.now() + 2 * 60 * 60 * 1000), // after 2 hours, delete the upload along with its files
        () => deleteUpload(upload._id)
      );
      uploadsMap[upload.id] = job;
    }
  } catch (e: any) {
    if (e.name === 'SigningError') {
      console.error('Internal server error: Google service account credentials are missing or invalid.');
      // Send a user-friendly message
      res.status(500).json({ message: req.t("internal-server-error-please-try-again-later") });
    } else {
      console.error('Error:', e.message);
      res.status(400).json({ message: e.message });
    }
  }
});

uploadsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    if (!req.params.id)
      throw NotFoundExeption(req.t("invalid-link-files-not-found"));
    const upload = await Upload.findById(req.params.id || "")
      .populate({
        path: "user",
        select: {
          "subscription.type": 1, // used for determining whether user is tornado or free
        },
      })
      .where("isValid", true);
    if (!upload) throw NotFoundExeption(req.t("invalid-link-files-not-found"));
    res.json({ ...upload.toObject() });
  } catch (e: any) {
    res.status(e.status || 500).json({ message: e.message });
  }
});

uploadsRouter.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const upload = await Upload.findById(req.params.id || "");
    if (!upload) throw NotFoundExeption(req.t("invalid-link-files-not-found"));
    await upload.updateOne({
      $inc: { downloads: 1 },
    });
    const files = upload.files.map((f) =>
      storage.bucket(upload.bucket || Variables.publicBucket).file(f.filename)
    );
    if (files.length === 0) {
      res.status(404).send(req.t("bucket-is-empty"));
      return;
    }
    // Set appropriate headers for streaming as a zip file
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${upload.name}.zip"`
    );

    // Create an archiver instance with writable stream to the response
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    // Stream each file's contents into the zip archive
    for (const file of files) {
      const readStream = file.createReadStream();
      archive.append(readStream, { name: file.name });
    }

    // Finalize the archive and send it to the client
    archive.finalize();
  } catch (e: any) {
    res.status(e.status || 500).json({ message: e.message });
  }
});

uploadsRouter.get(
  "/:id/download-links",
  async (req: Request, res: Response) => {
    try {
      const upload = await Upload.findById(req.params.id);
      if (!upload) throw NotFoundExeption(req.t("files-not-found"));
      // increment donwloads
      await upload.updateOne({ $inc: { downloads: 1 } });
      // check whether already zipped
      if (upload.zipLocation) {
        res.json({ link: upload.zipLocation });
      } else {
        // generate download token
        const token = jwt.sign(
          {
            bucket: upload.bucket,
            files: upload.files.map((f) => f.filename),
            name: upload.name,
          },
          process.env.JWT_SECRET
        );
        res.json({ link: `${process.env.DOWNLOAD_URL}/download/${token}` });
      }
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  }
);

uploadsRouter.post("/:id", async (req: Request, res: Response) => {
  const validateUploadSchema = yup.object({
    emailData: yup.object({
      title: yup
        .string()
        .min(3, req.t("title-too-short-3-characters-required"))
        .required(req.t("title-is-required")),
      email: yup
        .string()
        .email(req.t("enter-a-valid-email"))
        .required(req.t("email-is-required")),
      emailToken: yup.string().required(req.t("token-is-required")),
    }),
  });
  // this route is accessed by frontend to indicate successful upload
  // an empty post request validates the upload as successful
  // emailData in post request is optional, supplied in case email is to be sent
  let isSuccess = false;
  let userId: string = "";
  try {
    // find upload
    const upload = await Upload.findById(req.params.id || "").populate("user");
    if (!upload) throw NotFoundExeption(req.t("invalid-link-files-not-found"));
    await Upload.findByIdAndUpdate(upload.id, {
      $set: {
        isValid: true,
      },
    });
    // check whether user is logged in
    const token = authToken(req);
    if (token) {
      try {
        const { _id } = jwt.verify(token, process.env.JWT_SECRET || "") as {
          _id: string;
        };
        userId = _id;
      } catch (e: any) {
        console.log(e.message);
      }
    }
    if (!userId) {
      // cancel the job that deletes the uploaded files for public user
      uploadsMap[upload._id.toString()]?.cancel();
      // create a new job for public uploads to delete the files after 24 hours
      uploadsMap[upload._id.toString()] = nodeScheduler.scheduleJob(
        new Date(Date.now() + 24 * 60 * 60 * 1000), // after 24 hours
        () => deleteUpload(upload._id.toString())
      );
    }
    // send email if email data is present
    if (req.body.emailData) {
      // validate data
      const { emailData: data } = validateUploadSchema.validateSync(req.body, {
        abortEarly: true,
      });
      // verify token and get uploadId
      const { uploadId } = jwt.verify(
        data.emailToken,
        process.env.JWT_SECRET
      ) as { uploadId: string };
      // compare upload ids
      if (req.params.id !== uploadId)
        throw BadRequestException(req.t("invalid-token"));
      // send mail
      await sendPublicEmail(
        {
          to: data.email,
          subject: data.title,
          downloadLink: `${process.env.FRONTEND_URL}/download?uploadId=${uploadId}`,
        },
        req.i18n.language
      );
      res.json({ success: req.t("email-sent-successfully") });
    }
    res.json({ success: req.t("upload-completed") });
    if (userId)
      sendNewUploadMail(
        {
          downloadLink: `${process.env.FRONTEND_URL}/download?uploadId=${upload.id}`,
          to: upload.user.email,
          fullName: upload.user.fullName,
          fileName: upload.name,
        },
        req.i18n.language
      );
    // initiate zipping
    isSuccess = true;
  } catch (e: any) {
    console.log(e);
    const status = resolveStatus(e);
    res.status(status).json({
      message: status === 500 ? req.t("internal-server-error") : e.message,
    });
  } finally {
    try {
      if (isSuccess) {
        const upload = await Upload.findById(req.params.id)
          .populate("user workspace")
          .lean();
        // initiate files zipping job
        await zipFiles({
          bucket: upload.bucket,
          files: upload.files.map((f) => f.filename),
          name: userId
            ? `${upload.user._id.toString()}/${upload.workspace._id.toString()}/${
                req.params.id
              }.zip`
            : `uploads/${req.params.id}.zip`,
          notifyUrl: `${process.env.BACKEND_URL}/uploads/${req.params.id}/zip`,
          metadata: {
            uploadId: req.params.id,
          },
        });
      }
    } catch (e) {
      console.log(e.message, e.stackTrace);
    }
  }
});

uploadsRouter.get("/:id/cover-image", async (req: Request, res: Response) => {
  try {
    const upload = await Upload.findById(req.params.id);
    if (!upload || !upload.coverImage)
      throw BadRequestException(req.t("image-not-found"));
    const stream = await storage
      .bucket(Variables.publicBucket)
      .file(upload.coverImage)
      .createReadStream();
    stream.pipe(res);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

uploadsRouter.post("/:id/zip", async (req: Request, res: Response) => {
  try {
    const data = req.body as IData;
    console.log(JSON.stringify(data, null, 2));
    if (!data.name || !data.bucket)
      throw BadRequestException("Name or bucket not supplied");
    const file = storage.bucket(data.bucket).file(data.name);
    if (!file.exists()) throw NotFoundExeption(req.t("file-not-found"));
    const upload = await Upload.findByIdAndUpdate(req.params.id, {
      $set: {
        zipLocation: `https://storage.googleapis.com/${data.bucket}/${data.name}`,
      },
    });
    res.json(upload.toObject());
  } catch (e: any) {
    console.log(e);
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

uploadsRouter.post("/:id/email", async (req: Request, res: Response) => {
  try {
    const upload = await Upload.findById(req.params.id).populate("user");
    if (!upload || !upload.user)
      throw BadRequestException(req.t("upload-not-found"));
    const content = req.body.content;
    if (!content || typeof content !== "string")
      throw BadRequestException(req.t("invalid-request"));
    sendEmailToUploader({
      to: upload.user.email,
      content,
    });
    res.json({ success: "Email sent" });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

uploadsRouter.get("/images/:imageName", async (req: Request, res: Response) => {
  try {
    const img = req.params.imageName;
    if (
      !img.endsWith(".png") &&
      !img.endsWith(".jpg") &&
      !img.endsWith(".jpeg")
    )
      throw BadRequestException(req.t("invalid-image-file"));
    const file = await storage.bucket(Variables.publicBucket).file(img);
    if (!file.exists()) throw NotFoundExeption(req.t("file-not-found"));
    const stream = file.createReadStream();
    stream.pipe(res);
  } catch (e: any) {
    console.log(e);
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

export default uploadsRouter;
