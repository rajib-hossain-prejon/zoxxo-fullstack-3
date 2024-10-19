import { Router, Response, NextFunction } from "express";
import * as yup from "yup";
import multer from "multer";
import crypto from "crypto";
import mongoose from "mongoose";
import { File } from "@google-cloud/storage";

import IRequest from "../../interfaces/IRequest";
import { Request } from "express";
import {
  BadRequestException,
  InternalServerException,
  NotFoundExeption,
  resolveStatus,
} from "../../services/HttpException";
import User from "../../models/User";
import Workspace from "../../models/Workspace";
import storage, {
  getFileUploadSignedURL,
} from "../../services/google-cloud-storage";
import Upload from "../../models/Upload";
import { IUpload } from "../../interfaces/IUpload";
import { sendNewUploadMail } from "../../services/transport";
import { zipFiles } from "../../services/google-cloud-run";
import { Variables } from "../../utils/variables";
import MonetizationModel from "../../models/Monetization";
import IWorkspace from "../../interfaces/IWorkspace";
const TWO_GB_LIMIT = 2 * 1000 * 1000 * 1000;
const FOUR_GB_LIMIT = 4 * 1000 * 1000 * 1000;

const workspacesRouter = Router();

workspacesRouter.get("/", async (req: IRequest, res: Response) => {
  try {
    const workspaces = await Workspace.find()
      .where("_id", req.user._id)
      .populate({
        path: "uploads",
        match: { isValid: true },
      });
     
    res.json(workspaces);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

workspacesRouter.post("/", async (req: IRequest, res: Response) => {
  const workspaceNameSchema = yup
    .string()
    .min(3, req.t("workspace-name-too-short-3-characters-required"))
    .required(req.t("workspace-name-is-required"));
  try {
    const name = workspaceNameSchema.validateSync(req.body.name || "");
    const user = await User.findById(req.user._id);
    if (user.workspaces.length === user.maxWorkspaces)
      throw BadRequestException(
        req.t("can-not-create-workspace-maximum-workspaces-reached")
      );
    const foundWorkspace = await Workspace.findOne({ name });
    if (foundWorkspace)
      throw BadRequestException(req.t("workspace-already-exists"));
    const workspace = await Workspace.create({
      name,
      user: user._id,
    });
    await User.updateOne(
      { _id: req.user._id },
      {
        $push: {
          workspaces: workspace.id,
        },
      }
    );
    res.json(workspace.toObject());
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

workspacesRouter.get("/:_id", async (req: IRequest, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.params._id)
    .populate({
      path:"uploads",
      match:{isValid:true}
        })
      .populate("user")
      .lean();
      const Monetize = await MonetizationModel.find({
        workspaceId: { $in: req.params._id }
      }).populate({
        path: "uploadId",
      });
      
      console.log(Monetize,'Monetize')
    res.json([workspace,Monetize]);
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

 

workspacesRouter.post("/:_id/name", async (req: IRequest, res: Response) => {
  const workspaceNameSchema = yup
    .string()
    .min(3, req.t("workspace-name-too-short-3-characters-required"))
    .required(req.t("workspace-name-is-required"));
  try {
    const name = workspaceNameSchema.validateSync(req.body.name || "");
    const foundWorkspace = await Workspace.findOne({ name });
    if (foundWorkspace)
      throw BadRequestException(req.t("workspace-already-exists"));
    const workspace = await Workspace.findByIdAndUpdate(
      req.params._id,
      {
        name,
      },
      { new: true }
    );
    res.json(workspace.toObject());
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
  },
});
workspacesRouter.post(
  "/:_id/cover-image",
  upload.single("coverImage"),
  async (req: IRequest, res: Response,next:NextFunction) => {
    let oldFile: File;
    try {
      if (!req.file) throw BadRequestException(req.t("no-file-supplied"));
      if (req.body.color && req.body.color.length > 6)
        throw BadRequestException(
          req.t("invalid-color-hex-value-should-be-6-characters")
        );
      const workspace = await Workspace.findById(req.params._id);
      if (!workspace) throw NotFoundExeption(req.t("workspace-not-found"));
      const { originalname, buffer, mimetype } = req.file;
      if (!["image/png", "image/jpg", "image/jpeg"].includes(mimetype))
        throw BadRequestException(req.t("file-type-should-be-png-jpg-or-jpeg"));
      oldFile = workspace.coverImage
        ? storage.bucket(Variables.publicBucket).file(workspace.coverImage)
        : undefined;
      const filename = crypto.randomUUID().slice(0, 18) + "---" + originalname;
      const gFile = storage.bucket(Variables.publicBucket).file(filename);
      // pipe the file contents (buffer) to Google Cloud File
      const stream = gFile.createWriteStream({
        metadata: {
          contentType: mimetype,
        },
      });
      stream.on("error", () => {
      return next(InternalServerException(
          req.t("error-occured-while-uploading-file")
        ));
      });
      stream.end(buffer);
      stream.on("close", async () => {
        await workspace.updateOne(
          {
            $set: {
              coverImage: gFile.name,
              color: req.body.color ? `#${req.body.color}` : undefined,
            },
          },
          { new: true }
        );
        res.json(workspace);
      });
    } catch (e: any) {
      // res.status(resolveStatus(e)).json({ message: e.message });
       return next(e)
    } finally {
      if (await oldFile?.exists()) oldFile.delete();
    }
  }
);

const schema = yup.object({
  files: yup
    .array()
    .of(
      yup.object({
        name: yup
          .string()
          .min(3, "Filename should have at least 3 characters")
          .required("Filename is required"),
        size: yup
          .number()
          .integer("Invalid size value, contains decimals")
          .min(1, "Size too small")
          .max(1 * 1000 * 1000 * 1000 * 1000, "Size too large") // 1TB
          .required("Size is required"),
      })
    )
    .required("Files are required"),
  color: yup
    .string()
    .length(6, "Invalid color value, should be 6 characters hex value"),
});
workspacesRouter.post(
  "/:_id/uploads",
  upload.single("coverImage"),
  async (req: IRequest, res: Response) => {
    try {
      // parse data for validation
      const d: {
        fileNames: string[];
        sizes: string[];
        files: { name: string; size: number }[];
      } = {
        ...req.body,
        fileNames: Array.isArray(req.body.files)
          ? req.body.files
          : [req.body.files],
        sizes: Array.isArray(req.body.sizes)
          ? req.body.sizes
          : [req.body.sizes],
        fileObjects: [],
      };
      d.files = d.fileNames.map((f, i) => ({
        name: f,
        size: Number(d.sizes[i]),
      }));
      // validate data
      const { files, color } = schema.validateSync(d, {
        stripUnknown: true,
        abortEarly: true,
      });
      // find the workspace
      const workspace = await Workspace.findById(req.params._id);
      if (!workspace) throw NotFoundExeption(req.t("workspace-not-found"));
      // get user data including workspaces
      const user = await User.findById(req.user._id).populate({
        path: "workspaces",
        populate: {
          path: "uploads",
          match: { isValid: true },
        },
      });
      // calculate files total size
      const totalSize = files.reduce((sum = 0, f) => f.size + sum, 0);
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
          throw BadRequestException(req.t("can-not-upload-more-than-2-GB"));
        else if (totalSize + totalSizeConsumed > FOUR_GB_LIMIT)
          throw BadRequestException(req.t("your-storage-is-not-enough"));
      }
      // tornado users can only uplod to max of their storage size
      else if (totalSize + totalSizeConsumed > user.storageSizeInBytes)
        throw BadRequestException(req.t("your-storage-is-not-enough"));
      // initiate cover image upload to google cloud
      let coverImageName = "";
      if (req.file) {
        const { originalname, buffer, mimetype } = req.file;
        if (!["image/png", "image/jpg", "image/jpeg"].includes(mimetype))
          throw BadRequestException(
            req.t("file-type-should-be-png-jpg-or-jpeg")
          );
        coverImageName =
          crypto.randomUUID().slice(0, 18) + "---" + originalname;
        const gFile = storage
          .bucket(Variables.publicBucket)
          .file(coverImageName);
        // pipe the file contents (buffer) to Google Cloud File
        const stream = gFile.createWriteStream({
          metadata: {
            contentType: mimetype,
          },
        });
        stream.on("error", () => {
          console.error("Error occured while uploading file");
        });
        stream.end(buffer);
      }
      // create upload id
      const uid = new mongoose.Types.ObjectId();
      // create upload and generate files links
      const links = await Promise.all(
        files.map((f) =>
          getFileUploadSignedURL(
            f.name,
            f.size,
            Variables.uploadsBucket,
            `${user._id.toString()}/${workspace._id.toString()}/${uid.toString()}`
          )
        )
      );
      const upload = await Upload.create({
        _id: uid,
        user: user?._id,
        workspace: user?.workspaces[0]._id,
        name: crypto.randomUUID().slice(0, 18), // random name for public upload
        files: files.map((f, idx) => ({
          filename: links[idx].newFilename,
          size: f.size,
        })),
        color: color ? `#${color}` : undefined,
        bucket: Variables.uploadsBucket,
        sizeInBytes: totalSize,
        coverImage: coverImageName,
      });
      await workspace.updateOne(
        {
          $push: {
            uploads: upload.id,
          },
        },
        { new: true }
      );
      // setting cors configuration so that upload can begin on frontend
      await storage.bucket(Variables.uploadsBucket).setCorsConfiguration([
        {
          maxAgeSeconds: 60 * 60, // 1 hr
          method: ["POST", "PUT", "OPTIONS"],
          origin: [
            "http://localhost:8000",
            "http://localhost:9000",
            "https://www.zoxxo.io",
            "https://zoxxo.io",

            // https://zedfoundation.de configuration
            "https://zoxxo-dev.ey.r.appspot.com", //app engine ->services->default(url)
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
      res.json({ uploadUrls: links.map((lnk) => lnk.url), upload });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  }
);

workspacesRouter.put(
  "/:_id/uploads/:uploadId",
  upload.single("coverImage"),
  async (req: IRequest, res: Response) => {
    const updateUploadSchema = yup.object({
      newFiles: yup
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
              .max(1 * 1000 * 1000 * 1000 * 1000, req.t("size-too-large")) // 1TB
              .required(req.t("size-is-required")),
          })
        )
        .min(1, req.t("add-at-least-1-new-file"))
        .nullable()
        .optional(),
      deletedFiles: yup
        .array()
        .of(
          yup
            .string()
            .min(3, req.t("filename-should-have-at-least-3-characters"))
        )
        .nullable()
        .optional(),
      color: yup
        .string()
        .length(
          6,
          req.t("invalid-color-value-should-be-6-characters-hex-value")
        ),
    });
    let bucketName = "";
    const delFiles: string[] = [];
    try {
      // parse data for validation
      const d: {
        newFileNames: string[];
        sizes: string[];
        newFiles: { name: string; size: number }[];
        deletedFiles?: string[];
      } = {
        ...req.body,
        newFileNames: req.body.newFileNames
          ? Array.isArray(req.body.newFileNames)
            ? req.body.newFileNames
            : [req.body.newFileNames]
          : undefined,
        sizes: req.body.sizes
          ? Array.isArray(req.body.sizes)
            ? req.body.sizes
            : [req.body.sizes]
          : undefined,
        fileObjects: [],
      };
      d.newFiles =
        d.newFileNames?.map((f, i) => ({
          name: f,
          size: Number(d.sizes[i]),
        })) || undefined;
      // validate data
      const {
        newFiles,
        color,
        deletedFiles: deletedFileNames,
      } = updateUploadSchema.validateSync(d, {
        stripUnknown: true,
        abortEarly: true,
      });
      // find the workspace
      const workspace = await Workspace.findById(req.params._id);
      if (!workspace) throw NotFoundExeption(req.t("workspace-not-found"));
      // find the upload
      let upload = await Upload.findById(req.params.uploadId);
      if (!upload) throw NotFoundExeption(req.t("upload-not-found"));
      // get user data including workspaces
      const user = await User.findById(req.user._id).populate({
        path: "workspaces",
        populate: {
          path: "uploads",
          match: { isValid: true },
        },
      });
      // calculate files total size
      const newFileTotalSize =
        newFiles?.reduce((sum = 0, f: any) => f.size + sum, 0) || 0;
      // get all deleted files size
      let deletedFilesTotalSize = 0;
      const unchangedFiles: { filename: string; size: number }[] = [];
      if (deletedFileNames && deletedFileNames.length > 0) {
        for (let i = 0; i < upload.files.length; i += 1) {
          let isMatched = false;
          for (let j = 0; j < deletedFileNames.length; j += 1) {
            if (upload.files[i].filename === deletedFileNames[j]) {
              deletedFilesTotalSize += upload.files[i].size;
              delFiles.push(upload.files[i].filename);
              isMatched = true;
              break; // no need to check for others
            }
          }
          if (!isMatched) unchangedFiles.push(upload.files[i]);
        }
      } else {
        unchangedFiles.push(...upload.files);
      }
      const totalSize =
        upload.sizeInBytes + newFileTotalSize - deletedFilesTotalSize;
      // limit totalSize according to user's registeration plan
      const allUploads = user.workspaces.reduce<IUpload[]>(
        (acc = [], curr) => [...acc, ...curr.uploads],
        []
      );
      const totalSizeConsumed = allUploads.reduce(
        (sum = 0, curr) => sum + curr.sizeInBytes,
        0
      );
      // registered users can only uplod to max of their storage size
      if (totalSize + totalSizeConsumed > user.storageSizeInBytes)
        throw BadRequestException(req.t("your-storage-is-not-enough"));
      let coverImageName = upload.coverImage || "";
      if (req.file && user.subscription.type) {
        // only tornado user can upload cover image for upload
        const coverImagePromise = new Promise((resolve, reject) => {
          const { originalname, buffer, mimetype } = req.file;
          if (!["image/png", "image/jpg", "image/jpeg"].includes(mimetype))
            throw BadRequestException(
              req.t("file-type-should-be-png-jpg-or-jpeg")
            );
          coverImageName =
            crypto.randomUUID().slice(0, 18) + "---" + originalname;
          const gFile = storage
            .bucket(Variables.publicBucket)
            .file(coverImageName);
          // pipe the file contents (buffer) to Google Cloud File
          const stream = gFile.createWriteStream({
            metadata: {
              contentType: mimetype,
            },
          });
          stream.on("error", (err) => {
            console.error("Error occured while uploading file");
            reject(err);
          });
          stream.end(buffer);
          stream.on("finish", resolve);
        });
        await coverImagePromise;
      }
      // generate files links
      const links = !newFiles
        ? []
        : await Promise.all(
            newFiles.map((f) =>
              getFileUploadSignedURL(
                f.name,
                f.size,
                Variables.uploadsBucket,
                `${user._id.toString()}/${workspace._id.toString()}/${
                  upload.id
                }`
              )
            )
          );
      // update the upload
      /* const updatedFiles = newFiles
        ? newFiles.map((f, idx) => ({
            filename: links[idx].newFilename,
            size: f.size,
          }))
        : [];
      updatedFiles.push(...unchangedFiles); */
      upload = await Upload.findByIdAndUpdate(
        upload._id,
        {
          $set: {
            files: unchangedFiles,
            color: color ? `#${color}` : upload.color,
            sizeInBytes: totalSize,
            coverImage: coverImageName,
            zipLocation: "",
          },
        },
        { new: true }
      );
      bucketName = upload.bucket;
      // setting cors configuration so that upload can begin on frontend
      if (newFiles) {
        await storage.bucket(Variables.uploadsBucket).setCorsConfiguration([
          {
            maxAgeSeconds: 60 * 60, // 1 hr
            method: ["POST", "PUT", "OPTIONS"],
            origin: [
              "http://localhost:8000",
              "http://localhost:9000",
              "https://www.zoxxo.io",
              "https://zoxxo.io",

              // dev.zoxxo.io configuration
              "https://zoxxo-dev.ey.r.appspot.com", //app engine ->services->default(url)
              // "https://dev.zoxxo.io", //custom domain for website
              "https://zedfoundation.de", //custom domain for website
              "https://fdownload.zoxxo.io", //cloud run domain mapping
              "https://fzip.zoxxo.io", // cloud run domain mapping

              // dev.zoxxo.io configuration
              "https://zoxxo-dev.ey.r.appspot.com", //app engine ->services->default(url)
              "https://zedfoundation.de", //custom domain for website
              "https://fdownload.zoxxo.io", //cloud run domain mapping
              "https://fzip.zoxxo.io", // cloud run domain mapping
            ],
            responseHeader: ["Content-Type"],
          },
        ]);
      }
      res.json({
        uploadUrls: links.map((lnk) => ({
          url: lnk.url,
          name: lnk.newFilename,
        })),
        upload,
      });
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    } finally {
      // handle post response server side logic
      try {
        if (bucketName && delFiles?.length > 0) {
          const promises = delFiles.map(
            (f, idx) =>
              new Promise((resolve, reject) => {
                // preventing number of parallel requests to gcloud
                setTimeout(() => {
                  storage
                    .bucket(bucketName)
                    .file(f)
                    .delete()
                    .then(resolve)
                    .catch(reject);
                }, 100 * idx);
              })
          );
          await Promise.allSettled(promises);
        }
      } catch (e) {
        console.log(e);
      }
    }
  }
);

// route for making an upload valid to indicate successful file upload
workspacesRouter.post(
  "/:_id/uploads/:uploadId",
  async (req: IRequest, res: Response) => {
    const postUploadSchema = yup.object({
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
              .max(
                1 * 1000 * 1000 * 1000 * 1000,
                req.t("size-too-large") // 1TB
              )
              .required(req.t("size-is-required")),
          })
        )
        .nullable()
        .optional(),
    });
    let isSuccess = false;
    let upload;
    try {
      const { files } = postUploadSchema.validateSync(req.body, {
        abortEarly: true,
        stripUnknown: true,
      });
      upload = await Upload.findByIdAndUpdate(
        req.params.uploadId,
        {
          $set: {
            isValid: true,
          },
          $push: {
            files:
              files && files.length
                ? files.map((f) => ({ filename: f.name, size: f.size }))
                : [],
          },
        },
        { new: true }
      ).populate("user");
      if (!upload) throw NotFoundExeption(req.t("upload-not-found"));
      res.json(upload);
      isSuccess = true;
      sendNewUploadMail(
        {
          downloadLink: `${process.env.FRONTEND_URL}/download?uploadId=${upload.id}`,
          to: req.user.email,
          fullName: upload.user.fullName,
          fileName: upload.name,
        },
        req.i18n.language
      );
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    } finally {
      try {
        if (isSuccess && upload) {
          // initiate files zipping job
          await zipFiles({
            bucket: upload.bucket,
            files: upload.files.map((f) => f.filename),
            name: `${upload.user._id.toString()}/${upload.workspace._id.toString()}/${upload._id.toString()}.zip`,
            notifyUrl: `${
              process.env.BACKEND_URL
            }/uploads/${upload._id.toString()}/zip`,
            metadata: {
              uploadId: upload._id.toString(),
            },
          });
        }
      } catch (e) {
        console.log(e.message, e.stackTrace);
      }
    }
  }
);

workspacesRouter.put(
  "/:_id/uploads/:uploadId/name",
  async (req: IRequest, res: Response) => {
    const workspaceNameSchema = yup
      .string()
      .min(3, req.t("workspace-name-too-short-3-characters-required"))
      .required(req.t("workspace-name-is-required"));
    try {
      // validate name, same criteria as workspace name
      const name = workspaceNameSchema.validateSync(req.body.name);
      // find the upload
      const upload = await Upload.findByIdAndUpdate(
        req.params.uploadId,
        {
          $set: {
            name,
          },
        },
        { new: true }
      );
      if (!upload) throw NotFoundExeption(req.t("upload-not-found"));
      res.json(upload);
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  }
);

 
workspacesRouter.put("/default/:workspaceId", async (req: IRequest, res: Response) => {
  try {
    const userId = req.user._id;   
    const { workspaceId } = req.params;   
     
    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      throw BadRequestException(req.t("invalid-workspace-id"));
    }

    const workspaceObjectId = new mongoose.Types.ObjectId(workspaceId);

     const user = await User.findById(userId);
    if (!user) throw NotFoundExeption(req.t("user-not-found"));

     const workspace: IWorkspace | null = await Workspace.findById(workspaceObjectId).exec();
    if (!workspace) throw NotFoundExeption(req.t("workspace-not-found"));

     if (!user.workspaces.includes(workspaceObjectId as any)) {
      throw BadRequestException(req.t("workspace-not-associated-with-user"));
    }

 
    user.defaultWorkspace = workspaceObjectId as any;   
    await user.save();

    res.json({
      message: req.t("default-workspace-updated-successfully"),
      defaultWorkspace: user.defaultWorkspace,
    });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});


workspacesRouter.put(
  "/:_id/uploads/:uploadId/move/:targetWorkspaceId",
  async (req: IRequest, res: Response) => {
    // move upload to another workspace
    try {
      const currentWs = await Workspace.findById(req.params._id);
      if (!currentWs)
        throw NotFoundExeption(req.t("current-workspace-not-found"));
      const targetWs = await Workspace.findById(req.params.targetWorkspaceId);
      if (!targetWs)
        throw NotFoundExeption(req.t("target-workspace-not-found"));
      // move the upload
      await targetWs.updateOne({
        $push: {
          uploads: new mongoose.Types.ObjectId(req.params.uploadId),
        },
      });
      // remove from old
      await currentWs.updateOne({
        $pull: {
          uploads: new mongoose.Types.ObjectId(req.params.uploadId),
        },
      });
      res.json(currentWs.toObject());
    } catch (e: any) {
      console.log(e);
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  }
);

workspacesRouter.delete(
  "/:_id/uploads/:uploadId",
  async (req: IRequest, res: Response) => {
    try {
      const upload = await Upload.findByIdAndDelete(req.params.uploadId);
      if (!upload) throw NotFoundExeption(req.t("upload-not-found"));
      // delete files from bucket
      upload.files.forEach((f) => {
        storage
          .bucket(upload.bucket)
          .file(f.filename)
          .delete()
          .catch((e) => console.log(e));
      });
      res.json(upload);
    } catch (e: any) {
      res.status(resolveStatus(e)).json({ message: e.message });
    }
  }
);

workspacesRouter.delete("/:_id", async (req: IRequest, res: Response) => {
  try {
    const workspace = await Workspace.findById(req.params._id).populate(
      "user uploads"
    );
    if (!workspace) throw NotFoundExeption(req.t("workspace-not-found"));
    if (
      workspace._id.toString() === workspace.user.defaultWorkspace.toString()
    ) {
      throw BadRequestException(
        req.t("can-not-delete-account-associated-workspace")
      );
    }
    // mark all uploads in the workspace to be invalid
    await Upload.updateMany(
      { _id: { $in: workspace.uploads.map((up) => up._id) } },
      {
        $set: {
          isValid: false,
          createdAt: Date(),
        },
        $unset: {
          user: 1,
          workspace: 1,
        },
      }
    );
    // remove workspace from user object
    await User.findByIdAndUpdate(
      workspace.user._id,
      {
        $pull: {
          workspaces: workspace._id,
        },
      },
      { new: true }
    );
    // delete the workspace coverImage
    if (workspace.coverImage) {
      const coverImage = storage
        .bucket(Variables.publicBucket)
        .file(workspace.coverImage);
      if (await coverImage.exists()) await coverImage.delete();
    }
    // delete the workspace object
    await Workspace.deleteOne({ _id: workspace._id });
    res.json({ _id: workspace._id });
  } catch (e: any) {
    res.status(resolveStatus(e)).json({ message: e.message });
  }
});

 

 
 


export default workspacesRouter;
