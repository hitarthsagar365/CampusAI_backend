const Material = require('../models/Material');

// @desc    Get all materials (with individual / department / audience filtering)
// @route   GET /api/materials
// @access  Private (Authenticated)
exports.getMaterials = async (req, res) => {
  try {
    const { department } = req.query;
    const userRole = (req.user?.role || '').toLowerCase();
    const userDept = req.user?.department || req.user?.course || '';
    const userEnrollment = req.user?.enrollment || '';

    let query = {};

    if (userRole === 'admin') {
      if (department && department !== 'All Departments') {
        query.targetDepartment = { $in: [department, 'All Departments'] };
      }
    } else if (userRole === 'student') {
      const deptMatches = ['All Departments'];
      if (userDept) deptMatches.push(userDept);

      query.$or = [
        // A. Individual material specifically for this student
        {
          $or: [
            { targetStudentEnrollment: userEnrollment },
            { student: userEnrollment }
          ]
        },
        // B. Department or Public material (student-accessible, NOT targeted to another student)
        {
          $and: [
            { targetDepartment: { $in: deptMatches } },
            {
              $or: [
                { targetType: { $ne: 'individual' } },
                { targetType: { $exists: false } }
              ]
            },
            {
              $or: [
                { targetStudentEnrollment: '' },
                { targetStudentEnrollment: null },
                { targetStudentEnrollment: { $exists: false } }
              ]
            },
            {
              $or: [
                { student: '' },
                { student: null },
                { student: { $exists: false } }
              ]
            },
            {
              $or: [
                { audience: { $in: ['Students', 'Students & Faculty', 'All Students', 'Everyone', 'All', '', null] } },
                { audience: { $exists: false } }
              ]
            }
          ]
        }
      ];
    } else if (userRole === 'faculty' || userRole === 'teacher') {
      const deptMatches = ['All Departments'];
      if (userDept) deptMatches.push(userDept);
      if (Array.isArray(req.user?.assignedSubjects)) {
        req.user.assignedSubjects.forEach((as) => {
          if (as?.course) deptMatches.push(as.course);
          if (as?.department) deptMatches.push(as.department);
        });
      }

      query.$or = [
        { targetDepartment: { $in: Array.from(new Set(deptMatches)) } },
        { uploadedBy: req.user?.name || 'Faculty' }
      ];
    }

    const materials = await Material.find(query).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: materials.length,
      data: materials
    });
  } catch (error) {
    console.error('Error fetching materials:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching materials.'
    });
  }
};

// @desc    Create a new material
// @route   POST /api/materials
// @access  Private (Admin/Teacher)
exports.createMaterial = async (req, res) => {
  try {
    const {
      title,
      subject,
      category,
      targetType,
      targetDepartment,
      targetStudentEnrollment,
      student,
      audience,
      course,
      semester,
      fileName,
      fileType,
      fileSize,
      fileData,
      description,
      uploadedBy
    } = req.body;

    if (!title || !subject || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, subject, and category must be provided.'
      });
    }

    const resolvedEnrollment = (targetStudentEnrollment || student || '').trim();
    let resolvedTargetType = targetType || 'all';
    if (resolvedEnrollment) {
      resolvedTargetType = 'individual';
    } else if (targetDepartment && targetDepartment !== 'All Departments') {
      resolvedTargetType = 'department';
    }

    const material = await Material.create({
      title: title.trim(),
      subject: subject.trim(),
      category: category.trim(),
      targetType: resolvedTargetType,
      targetDepartment: targetDepartment || 'All Departments',
      targetStudentEnrollment: resolvedEnrollment,
      student: resolvedEnrollment,
      audience: audience || 'Students',
      course: course || '',
      semester: semester || '',
      fileName: fileName || null,
      fileType: fileType || null,
      fileSize: fileSize || null,
      fileData: fileData || null,
      description: description || '',
      uploadedBy: uploadedBy || req.user?.name || 'Admin'
    });

    res.status(201).json({
      success: true,
      message: 'Material added successfully.',
      data: material
    });
  } catch (error) {
    console.error('Error creating material:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error creating material.'
    });
  }
};

// @desc    Delete a material
// @route   DELETE /api/materials/:id
// @access  Private (Admin)
exports.deleteMaterial = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found.'
      });
    }

    await Material.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Material deleted successfully.'
    });
  } catch (error) {
    console.error('Error deleting material:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting material.'
    });
  }
};
