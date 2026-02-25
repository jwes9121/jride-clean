package com.jride.app.data

import retrofit2.http.Body
import retrofit2.http.Headers
import retrofit2.http.POST

data class NudgeResponse(
    val id: Long,
    val created_at: String,
    val trip_id: String?,
    val note: String?
)

interface SupabaseRpcApi {

    @Headers("Content-Type: application/json")
    @POST("rpc/driver_get_recent_nudge")
    suspend fun getRecentNudge(
        @Body body: Map<String, String>
    ): List<NudgeResponse>
}
