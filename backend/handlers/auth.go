package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"gugudu-backend/database"
	"gugudu-backend/middleware"
	"gugudu-backend/models"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const maxAvatarUploadBytes = 2 << 20

// RegisterRequest 注册请求
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=50"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Nickname string `json:"nickname"`
}

// LoginRequest 登录请求
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// Register 用户注册
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查用户名是否已存在
	var existingUser models.User
	if err := database.DB.Where("username = ? OR email = ?", req.Username, req.Email).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Username or email already exists"})
		return
	}

	// 密码加密
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Username: req.Username,
		Email:    req.Email,
		Password: string(hashedPassword),
		Nickname: req.Nickname,
	}

	if err := database.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	defaultFolder := models.FavoriteFolder{
		UserID:    user.ID,
		Name:      "默认收藏夹",
		Icon:      "folder",
		SortOrder: 0,
		IsDefault: true,
	}
	database.DB.Create(&defaultFolder)

	// 生成 JWT token
	token, err := generateToken(user.ID, user.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"token":   token,
		"user": gin.H{
			"id":                user.ID,
			"username":          user.Username,
			"email":             user.Email,
			"nickname":          user.Nickname,
			"is_admin":          user.IsAdmin,
			"is_premium":        user.IsPremium,
			"membership_type":   user.MembershipType,
			"membership_expiry": user.MembershipExpiry,
		},
	})
}

// Login 用户登录
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 查找用户
	var user models.User
	if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// 验证密码
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}
	ensureMembershipActive(database.DB, &user)

	// 生成 JWT token
	token, err := generateToken(user.ID, user.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Login successful",
		"token":   token,
		"user": gin.H{
			"id":                user.ID,
			"username":          user.Username,
			"email":             user.Email,
			"nickname":          user.Nickname,
			"avatar":            user.Avatar,
			"is_admin":          user.IsAdmin,
			"is_premium":        user.IsPremium,
			"membership_type":   user.MembershipType,
			"membership_expiry": user.MembershipExpiry,
		},
	})
}

// GetProfile 获取用户信息
func GetProfile(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	ensureMembershipActive(database.DB, &user)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"id":                user.ID,
			"username":          user.Username,
			"email":             user.Email,
			"nickname":          user.Nickname,
			"avatar":            user.Avatar,
			"is_admin":          user.IsAdmin,
			"is_premium":        user.IsPremium,
			"membership_type":   user.MembershipType,
			"membership_expiry": user.MembershipExpiry,
			"total_read_time":   user.TotalReadTime,
			"articles_read":     user.ArticlesRead,
			"words_learned":     user.WordsLearned,
			"created_at":        user.CreatedAt,
		},
	})
}

// UploadAvatar 上传并更新当前用户头像
func UploadAvatar(c *gin.Context) {
	userID, _ := c.Get("user_id")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAvatarUploadBytes+(128<<10))

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar file is required"})
		return
	}

	if fileHeader.Size > maxAvatarUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar must be 2MB or smaller"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to open avatar file"})
		return
	}
	defer file.Close()

	head := make([]byte, 512)
	n, err := file.Read(head)
	if err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read avatar file"})
		return
	}

	contentType := http.DetectContentType(head[:n])
	ext, ok := avatarExtension(contentType)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Avatar must be a JPG, PNG, WebP, or GIF image"})
		return
	}

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process avatar file"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := os.MkdirAll("storage/avatars", 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare avatar storage"})
		return
	}

	token, err := randomHex(8)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate avatar filename"})
		return
	}

	filename := "user-" + strconv.FormatUint(uint64(user.ID), 10) + "-" + token + ext
	dstPath := filepath.Join("storage", "avatars", filename)
	dst, err := os.Create(dstPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save avatar"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save avatar"})
		return
	}

	avatarURL := "/storage/avatars/" + filename
	if err := database.DB.Model(&user).Update("avatar", avatarURL).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update avatar"})
		return
	}

	removeOldAvatar(user.Avatar)

	c.JSON(http.StatusOK, gin.H{
		"message": "Avatar updated successfully",
		"data": gin.H{
			"avatar": avatarURL,
		},
	})
}

func avatarExtension(contentType string) (string, bool) {
	switch contentType {
	case "image/jpeg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/webp":
		return ".webp", true
	case "image/gif":
		return ".gif", true
	default:
		return "", false
	}
}

func randomHex(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func removeOldAvatar(avatar string) {
	if !strings.HasPrefix(avatar, "/storage/avatars/") {
		return
	}

	_ = os.Remove(filepath.Join(".", filepath.FromSlash(strings.TrimPrefix(avatar, "/"))))
}

// generateToken 生成 JWT token
func generateToken(userID uint, username string) (string, error) {
	claims := middleware.Claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * 7 * time.Hour)), // 7天过期
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	return middleware.SignToken(claims)
}
