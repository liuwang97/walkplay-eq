/**
 * React Query hooks over the typed cloud-API endpoints.
 *
 * Queries are read-only fetches with stable keys (see ./queryClient.ts);
 * mutations invalidate the affected queries so the UI stays consistent after
 * like / collect / comment actions and after login.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { qk } from "./queryClient";
import {
  checkFirmwareVersion,
  commentLike,
  commentSubmit,
  commentsList,
  eqCancelLike,
  eqCollect,
  eqLike,
  eqWatching,
  getFirmwareInfoListByPidAndVid,
  getReportType,
  getUserDetail,
  loginByVCodePC,
  queryUserEQShareInfoList,
  shareEqGraph,
  updateUserCustomEQ,
  uploadEqShareGraphImage,
  wxPcLogin,
} from "./endpoints";
import type {
  CheckFirmwareReq,
  CommentItem,
  CommentLikeReq,
  CommentSubmitReq,
  EqIdReq,
  EqShareItem,
  EqWatchingReq,
  FirmwareInfo,
  LoginByVCodeReq,
  LoginResult,
  ReportType,
  ShareEqGraphReq,
  UpdateUserCustomEqReq,
  UploadGraphResp,
  UserDetail,
  WxPcLoginReq,
} from "./types";

type QueryOpts<T> = Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">;
type MutOpts<TData, TVars> = Omit<
  UseMutationOptions<TData, Error, TVars>,
  "mutationFn"
>;

/* ----------------------------- Queries ----------------------------- */

/** List online / shared EQs for a (vid, pid). */
export function useEqShareList(
  params: { vid?: number; pid?: number; adc?: boolean } = {},
  opts?: QueryOpts<EqShareItem[]>,
) {
  const { vid, pid, adc } = params;
  return useQuery<EqShareItem[], Error>({
    queryKey: qk.eqShareList(vid, pid, adc),
    queryFn: ({ signal }) => queryUserEQShareInfoList({ vid, pid }, { signal, adc }),
    ...opts,
  });
}

/** Report-type categories. */
export function useReportType(opts?: QueryOpts<ReportType[]>) {
  return useQuery<ReportType[], Error>({
    queryKey: qk.reportType(),
    queryFn: ({ signal }) => getReportType({ signal }),
    ...opts,
  });
}

/** Firmware list for a (vid, pid). */
export function useFirmwareList(
  vid: number,
  pid: number,
  opts?: QueryOpts<FirmwareInfo[]>,
) {
  return useQuery<FirmwareInfo[], Error>({
    queryKey: qk.firmwareList(vid, pid),
    queryFn: ({ signal }) => getFirmwareInfoListByPidAndVid(vid, pid, { signal }),
    ...opts,
  });
}

/** Comments for an EQ. */
export function useComments(eqId: number, opts?: QueryOpts<CommentItem[]>) {
  return useQuery<CommentItem[], Error>({
    queryKey: qk.comments(eqId),
    queryFn: ({ signal }) => commentsList({ eqId }, { signal }),
    enabled: eqId > 0,
    ...opts,
  });
}

/** Current user detail. */
export function useUserDetail(opts?: QueryOpts<UserDetail | null>) {
  return useQuery<UserDetail | null, Error>({
    queryKey: qk.userDetail(),
    queryFn: ({ signal }) => getUserDetail({ signal }),
    ...opts,
  });
}

/* ---------------------------- Mutations ---------------------------- */

/** Like a shared EQ (invalidates the share list). */
export function useEqLike(opts?: MutOpts<unknown, EqIdReq>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EqIdReq>({
    mutationFn: (vars) => eqLike(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eq", "shareList"] }),
    ...opts,
  });
}

/** Cancel a like (invalidates the share list). */
export function useEqCancelLike(opts?: MutOpts<unknown, EqIdReq>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EqIdReq>({
    mutationFn: (vars) => eqCancelLike(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eq", "shareList"] }),
    ...opts,
  });
}

/** Collect / favorite a shared EQ (invalidates the share list). */
export function useEqCollect(opts?: MutOpts<unknown, EqIdReq>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EqIdReq>({
    mutationFn: (vars) => eqCollect(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eq", "shareList"] }),
    ...opts,
  });
}

/** Send a usage "watching" ping (fire-and-forget). */
export function useEqWatching(opts?: MutOpts<unknown, EqWatchingReq>) {
  return useMutation<unknown, Error, EqWatchingReq>({
    mutationFn: (vars) => eqWatching(vars),
    ...opts,
  });
}

/** Update the user's custom EQ. */
export function useUpdateUserCustomEQ(opts?: MutOpts<unknown, UpdateUserCustomEqReq>) {
  return useMutation<unknown, Error, UpdateUserCustomEqReq>({
    mutationFn: (vars) => updateUserCustomEQ(vars),
    ...opts,
  });
}

/** Upload an EQ preview-graph image (step 1 of sharing). */
export function useUploadEqShareGraphImage(opts?: MutOpts<UploadGraphResp, Blob>) {
  return useMutation<UploadGraphResp, Error, Blob>({
    mutationFn: (file) => uploadEqShareGraphImage(file),
    ...opts,
  });
}

/** Create a share record from an EQ graph (step 2 of sharing). */
export function useShareEqGraph(opts?: MutOpts<unknown, ShareEqGraphReq>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, ShareEqGraphReq>({
    mutationFn: (vars) => shareEqGraph(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eq", "shareList"] }),
    ...opts,
  });
}

/** Check firmware version. */
export function useCheckFirmwareVersion(
  opts?: MutOpts<FirmwareInfo | null, CheckFirmwareReq>,
) {
  return useMutation<FirmwareInfo | null, Error, CheckFirmwareReq>({
    mutationFn: (vars) => checkFirmwareVersion(vars),
    ...opts,
  });
}

/** Like a comment (invalidates that EQ's comment list). */
export function useCommentLike(
  eqId: number,
  opts?: MutOpts<unknown, CommentLikeReq>,
) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CommentLikeReq>({
    mutationFn: (vars) => commentLike(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.comments(eqId) }),
    ...opts,
  });
}

/** Submit a comment (invalidates that EQ's comment list). */
export function useCommentSubmit(opts?: MutOpts<unknown, CommentSubmitReq>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CommentSubmitReq>({
    mutationFn: (vars) => commentSubmit(vars),
    onSuccess: (_d, vars) =>
      void qc.invalidateQueries({ queryKey: qk.comments(vars.eqId) }),
    ...opts,
  });
}

/** Email + vcode login (token stored on success; refreshes user detail). */
export function useLoginByVCode(opts?: MutOpts<LoginResult, LoginByVCodeReq>) {
  const qc = useQueryClient();
  return useMutation<LoginResult, Error, LoginByVCodeReq>({
    mutationFn: (vars) => loginByVCodePC(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.userDetail() }),
    ...opts,
  });
}

/** WeChat PC QR login completion (token stored on success). */
export function useWxPcLogin(opts?: MutOpts<LoginResult, WxPcLoginReq>) {
  const qc = useQueryClient();
  return useMutation<LoginResult, Error, WxPcLoginReq>({
    mutationFn: (vars) => wxPcLogin(vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.userDetail() }),
    ...opts,
  });
}
